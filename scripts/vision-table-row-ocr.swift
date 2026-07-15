import Foundation
import Vision
import ImageIO
import CoreGraphics

struct OCRItem: Encodable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct RowResult: Encodable {
    let score: Int
    let centerTop: Int
    let observations: [OCRItem]
}

struct PageResult: Encodable {
    let width: Int
    let height: Int
    let rows: [RowResult]
}

struct RawPageResult: Encodable {
    let width: Int
    let height: Int
    let observations: [OCRItem]
}

struct GridSpec {
    let firstScore: Int
    let rowCount: Int
    let firstCenterTop: Double
    let rowPitch: Double
}

func usage() -> Never {
    fputs("Usage: vision-table-row-ocr /path/image [x y width height] [firstScore rowCount firstCenterTop rowPitch]\n       vision-table-row-ocr /path/image --raw x y width height\n", stderr)
    exit(2)
}

if CommandLine.arguments.count != 2 && CommandLine.arguments.count != 6 && CommandLine.arguments.count != 7 && CommandLine.arguments.count != 10 {
    usage()
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      let loadedImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("Could not load image: \(imageURL.path)\n", stderr)
    exit(1)
}

func recognize(_ cgImage: CGImage) throws -> [OCRItem] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = false
    request.minimumTextHeight = 0.01
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])
    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return OCRItem(
            text: candidate.string,
            confidence: candidate.confidence,
            x: box.origin.x,
            y: box.origin.y,
            width: box.size.width,
            height: box.size.height
        )
    }
}

func rawScaleFactor() -> Double {
    guard let value = ProcessInfo.processInfo.environment["VISION_TABLE_OCR_SCALE"],
          let parsed = Double(value),
          parsed > 1.0 else {
        return 1.0
    }
    return min(parsed, 12.0)
}

func scaledForRawOCR(_ cgImage: CGImage) -> CGImage {
    let scale = rawScaleFactor()
    guard scale > 1.0 else { return cgImage }
    let scaledWidth = max(1, Int((Double(cgImage.width) * scale).rounded()))
    let scaledHeight = max(1, Int((Double(cgImage.height) * scale).rounded()))
    let colorSpace = cgImage.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!
    guard let context = CGContext(
        data: nil,
        width: scaledWidth,
        height: scaledHeight,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        return cgImage
    }
    context.interpolationQuality = .none
    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: scaledWidth, height: scaledHeight))
    return context.makeImage() ?? cgImage
}

let image: CGImage
let gridSpec: GridSpec?
if CommandLine.arguments.count == 7 {
    guard CommandLine.arguments[2] == "--raw" else {
        usage()
    }
    let cropValues = CommandLine.arguments[3...6].compactMap { Int($0) }
    guard cropValues.count == 4 else {
        fputs("Raw crop arguments must be integers: x y width height\n", stderr)
        exit(2)
    }
    let cropRect = CGRect(x: cropValues[0], y: cropValues[1], width: cropValues[2], height: cropValues[3])
    guard let cropped = loadedImage.cropping(to: cropRect) else {
        fputs("Could not crop image: \(cropRect)\n", stderr)
        exit(1)
    }
    let scaled = scaledForRawOCR(cropped)
    let result = RawPageResult(width: scaled.width, height: scaled.height, observations: try recognize(scaled))
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(result)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(0)
} else if CommandLine.arguments.count == 6 || CommandLine.arguments.count == 10 {
    let cropValues = CommandLine.arguments[2...5].compactMap { Int($0) }
    guard cropValues.count == 4 else {
        fputs("Crop arguments must be integers: x y width height\n", stderr)
        exit(2)
    }
    let cropRect = CGRect(x: cropValues[0], y: cropValues[1], width: cropValues[2], height: cropValues[3])
    guard let cropped = loadedImage.cropping(to: cropRect) else {
        fputs("Could not crop image: \(cropRect)\n", stderr)
        exit(1)
    }
    image = cropped
    if CommandLine.arguments.count == 10 {
        guard let firstScore = Int(CommandLine.arguments[6]),
              let rowCount = Int(CommandLine.arguments[7]),
              let firstCenterTop = Double(CommandLine.arguments[8]),
              let rowPitch = Double(CommandLine.arguments[9]),
              rowCount > 0,
              rowPitch > 0 else {
            fputs("Grid arguments must be: firstScore rowCount firstCenterTop rowPitch\n", stderr)
            exit(2)
        }
        gridSpec = GridSpec(
            firstScore: firstScore,
            rowCount: rowCount,
            firstCenterTop: firstCenterTop,
            rowPitch: rowPitch
        )
    } else {
        gridSpec = nil
    }
} else {
    image = loadedImage
    gridSpec = nil
}

func scoreFromText(_ text: String) -> Int? {
    if let range = text.range(of: #"(\d{3})\s*分"#, options: .regularExpression) {
        let matched = String(text[range])
        guard let numberRange = matched.range(of: #"\d{3}"#, options: .regularExpression) else { return nil }
        return Int(matched[numberRange])
    }
    guard let range = text.range(of: #"^\s*\d{3}\s*$"#, options: .regularExpression) else { return nil }
    return Int(text[range].trimmingCharacters(in: .whitespacesAndNewlines))
}

func median(_ values: [Double]) -> Double? {
    guard !values.isEmpty else { return nil }
    let sorted = values.sorted()
    return sorted[sorted.count / 2]
}

let width = image.width
let height = image.height
let scoreRows: [(score: Int, centerTop: Double)]
if let gridSpec {
    scoreRows = (0..<gridSpec.rowCount).map { index in
        (
            score: gridSpec.firstScore - index,
            centerTop: gridSpec.firstCenterTop + Double(index) * gridSpec.rowPitch
        )
    }
} else {
    let scoreColumnWidth = max(260, Int(Double(width) * 0.34))
    guard let scoreCrop = image.cropping(to: CGRect(x: 0, y: 0, width: scoreColumnWidth, height: height)) else {
        fputs("Could not crop score column\n", stderr)
        exit(1)
    }

    let scoreItems = try recognize(scoreCrop)
    scoreRows = scoreItems.compactMap { item -> (score: Int, centerTop: Double)? in
        guard let score = scoreFromText(item.text), score >= 100, score <= 750 else { return nil }
        let centerTop = (1.0 - (item.y + item.height / 2.0)) * Double(height)
        return (score, centerTop)
    }.sorted { first, second in
        if first.score == second.score { return first.centerTop < second.centerTop }
        return first.score > second.score
    }
}

var centerTops = scoreRows.map(\.centerTop).sorted()
var diffs: [Double] = []
if centerTops.count >= 2 {
    for index in 1..<centerTops.count {
        let diff = centerTops[index] - centerTops[index - 1]
        if diff > 30 { diffs.append(diff) }
    }
}
let rowPitch = median(diffs) ?? max(80.0, Double(height) / 28.0)
let rowHeight = rowPitch * 0.94

let rows = try scoreRows.map { scoreRow -> RowResult in
    let top = max(0.0, scoreRow.centerTop - rowPitch * 0.47)
    let boundedHeight = min(Double(height) - top, rowHeight)
    let rect = CGRect(
        x: 0,
        y: Int(top),
        width: width,
        height: max(1, Int(boundedHeight))
    )
    guard let rowCrop = image.cropping(to: rect) else {
        throw NSError(domain: "vision-table-row-ocr", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not crop row"])
    }
    return RowResult(
        score: scoreRow.score,
        centerTop: Int(scoreRow.centerTop.rounded()),
        observations: try recognize(rowCrop)
    )
}

let result = PageResult(width: width, height: height, rows: rows)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(result)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
