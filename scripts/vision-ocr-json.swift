#!/usr/bin/env swift

import Foundation
import Vision
import ImageIO

struct OcrItem {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

func usage() -> String {
    return "Usage: swift scripts/vision-ocr-json.swift IMAGE_PATH [OUT_JSON]"
}

guard CommandLine.arguments.count >= 2 else {
    fputs("\(usage())\n", stderr)
    exit(2)
}

let imagePath = CommandLine.arguments[1]
let outPath = CommandLine.arguments.count >= 3 ? CommandLine.arguments[2] : nil
let imageURL = URL(fileURLWithPath: imagePath)

guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("Unable to load image: \(imagePath)\n", stderr)
    exit(1)
}

var items: [OcrItem] = []
var requestError: Error?

let request = VNRecognizeTextRequest { request, error in
    if let error {
        requestError = error
        return
    }
    let observations = request.results as? [VNRecognizedTextObservation] ?? []
    for observation in observations {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let box = observation.boundingBox
        items.append(OcrItem(
            text: candidate.string,
            confidence: candidate.confidence,
            x: Double(box.origin.x),
            y: Double(box.origin.y),
            width: Double(box.size.width),
            height: Double(box.size.height)
        ))
    }
}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["zh-Hans", "en-US"]

let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])

do {
    try handler.perform([request])
} catch {
    fputs("Vision OCR failed: \(error)\n", stderr)
    exit(1)
}

if let requestError {
    fputs("Vision OCR failed: \(requestError)\n", stderr)
    exit(1)
}

let sorted = items.sorted {
    if abs($0.y - $1.y) > 0.01 { return $0.y > $1.y }
    return $0.x < $1.x
}

let payload: [String: Any] = [
    "imagePath": imagePath,
    "imageWidth": image.width,
    "imageHeight": image.height,
    "items": sorted.map { item in
        [
            "text": item.text,
            "confidence": item.confidence,
            "bbox": [
                "x": item.x,
                "y": item.y,
                "width": item.width,
                "height": item.height,
            ],
        ] as [String: Any]
    },
]

let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])

if let outPath {
    try data.write(to: URL(fileURLWithPath: outPath))
    print(outPath)
} else {
    FileHandle.standardOutput.write(data)
    print("")
}
