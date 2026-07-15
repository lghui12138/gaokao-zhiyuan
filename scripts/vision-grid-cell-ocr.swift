import Foundation
import Vision
import ImageIO
import CoreGraphics

struct OCRCell: Encodable {
    let row: Int
    let col: String
    let text: String
    let confidence: Float
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

struct OCRResult: Encodable {
    let imageWidth: Int
    let imageHeight: Int
    let rowCount: Int
    let cells: [OCRCell]
}

func usage() -> Never {
    fputs("Usage: vision-grid-cell-ocr image rowCount firstRowTop rowPitch x1 x2 x3 [scale]\n", stderr)
    fputs("Reads numeric people/cumulative cells from a six-column score table. x1/x2/x3 are vertical grid lines around people and cumulative columns.\n", stderr)
    exit(2)
}

guard CommandLine.arguments.count == 8 || CommandLine.arguments.count == 9 else {
    usage()
}

let imagePath = CommandLine.arguments[1]
guard let rowCount = Int(CommandLine.arguments[2]),
      let firstRowTop = Int(CommandLine.arguments[3]),
      let rowPitch = Int(CommandLine.arguments[4]),
      let xPeopleLeft = Int(CommandLine.arguments[5]),
      let xCumLeft = Int(CommandLine.arguments[6]),
      let xCumRight = Int(CommandLine.arguments[7]),
      rowCount > 0,
      rowPitch > 0,
      xPeopleLeft >= 0,
      xCumLeft > xPeopleLeft,
      xCumRight > xCumLeft else {
    usage()
}

let scale = CommandLine.arguments.count == 9 ? max(1, min(12, Int(CommandLine.arguments[8]) ?? 8)) : 8
let imageURL = URL(fileURLWithPath: imagePath)
guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      let loadedImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("Could not load image: \(imagePath)\n", stderr)
    exit(1)
}

func scaled(_ cgImage: CGImage, by scale: Int) -> CGImage {
    guard scale > 1 else { return cgImage }
    let scaledWidth = max(1, cgImage.width * scale)
    let scaledHeight = max(1, cgImage.height * scale)
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

func recognizeDigits(_ cgImage: CGImage) throws -> (String, Float) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US"]
    request.usesLanguageCorrection = false
    request.minimumTextHeight = 0.05
    let handler = VNImageRequestHandler(cgImage: scaled(cgImage, by: scale), options: [:])
    try handler.perform([request])
    let candidates = (request.results ?? []).compactMap { observation -> (String, Float)? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let digits = candidate.string.replacingOccurrences(of: #"[^0-9]"#, with: "", options: .regularExpression)
        if digits.isEmpty { return nil }
        return (digits, candidate.confidence)
    }
    guard let best = candidates.max(by: { $0.1 < $1.1 }) else {
        return ("", 0)
    }
    return best
}

let columns = [
    ("people", xPeopleLeft + 2, xCumLeft - xPeopleLeft - 4),
    ("cumulative", xCumLeft + 2, xCumRight - xCumLeft - 4),
]

var cells: [OCRCell] = []
for row in 0..<rowCount {
    let rowTop = firstRowTop + row * rowPitch
    for (name, x, width) in columns {
        let rect = CGRect(x: x, y: rowTop + 2, width: width, height: max(1, rowPitch - 4))
        guard let crop = loadedImage.cropping(to: rect) else {
            fputs("Could not crop row \(row) col \(name)\n", stderr)
            exit(1)
        }
        let (text, confidence) = try recognizeDigits(crop)
        cells.append(OCRCell(
            row: row,
            col: name,
            text: text,
            confidence: confidence,
            x: x,
            y: rowTop + 2,
            width: width,
            height: max(1, rowPitch - 4)
        ))
    }
}

let result = OCRResult(
    imageWidth: loadedImage.width,
    imageHeight: loadedImage.height,
    rowCount: rowCount,
    cells: cells
)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(result)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
