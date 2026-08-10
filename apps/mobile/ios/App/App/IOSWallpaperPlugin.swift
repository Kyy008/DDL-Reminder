import Capacitor
import Foundation
import ImageIO
import PhotosUI
import UIKit
import UniformTypeIdentifiers

@objc(IOSWallpaperPlugin)
public final class IOSWallpaperPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
    public let identifier = "IOSWallpaperPlugin"
    public let jsName = "IOSWallpaper"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "chooseAndPrepare", returnType: CAPPluginReturnPromise)
    ]

    private static let maximumSourceBytes = 30 * 1024 * 1024
    private static let maximumMainBytes = 5 * 1024 * 1024
    private static let maximumBlurBytes = 300 * 1024
    private static let maximumMainEdge = 2_880
    private static let maximumMainPixels = 8_000_000
    private static let maximumBlurEdge = 640
    private static let maximumBlurPixels = 640 * 640
    private static let resizeAttempts = 5
    private static let resizeFactor = 0.85
    private static let mainQualities: [CGFloat] = [0.86, 0.78, 0.70, 0.62, 0.54]
    private static let blurQualities: [CGFloat] = [0.76, 0.66, 0.56, 0.46]

    private let fileManager = FileManager.default
    private let processingQueue = DispatchQueue(
        label: "com.kyy.ddlreminder.wallpaper-processing",
        qos: .userInitiated
    )
    private var pendingPickerCall: CAPPluginCall?
    private var isBusy = false

    @objc public func chooseAndPrepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject(
                    "没能打开图片选择器，请稍后再试。",
                    WallpaperFailure.pickerUnavailable.code
                )
                return
            }

            self.presentPicker(for: call)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard let call = pendingPickerCall else {
            picker.dismiss(animated: true)
            return
        }

        pendingPickerCall = nil

        guard let result = results.first else {
            picker.dismiss(animated: true) { [weak self] in
                self?.finish(call, with: .failure(WallpaperFailure.pickerCancelled))
            }
            return
        }

        let provider = result.itemProvider

        guard let typeIdentifier = preferredImageTypeIdentifier(for: provider) else {
            picker.dismiss(animated: true) { [weak self] in
                self?.finish(call, with: .failure(WallpaperFailure.unsupportedImage))
            }
            return
        }

        picker.dismiss(animated: true) { [weak self] in
            self?.loadAndPrepare(
                provider: provider,
                typeIdentifier: typeIdentifier,
                call: call
            )
        }
    }

    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard let call = pendingPickerCall else {
            return
        }

        pendingPickerCall = nil
        finish(call, with: .failure(WallpaperFailure.pickerCancelled))
    }
}

private extension IOSWallpaperPlugin {
    func presentPicker(for call: CAPPluginCall) {
        guard !isBusy else {
            call.reject(
                "正在处理上一张背景图片，请稍候。",
                WallpaperFailure.pickerBusy.code
            )
            return
        }

        guard let bridgeViewController = bridge?.viewController,
              bridgeViewController.viewIfLoaded?.window != nil else {
            call.reject(
                WallpaperFailure.pickerUnavailable.message,
                WallpaperFailure.pickerUnavailable.code
            )
            return
        }

        var presenter = bridgeViewController

        while let presentedViewController = presenter.presentedViewController,
              !presentedViewController.isBeingDismissed {
            presenter = presentedViewController
        }

        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .images
        configuration.selectionLimit = 1
        configuration.preferredAssetRepresentationMode = .current

        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        picker.presentationController?.delegate = self
        pendingPickerCall = call
        isBusy = true
        presenter.present(picker, animated: true)
    }

    func preferredImageTypeIdentifier(for provider: NSItemProvider) -> String? {
        provider.registeredTypeIdentifiers.first { identifier in
            guard let type = UTType(identifier) else {
                return false
            }

            return type.conforms(to: .image)
        }
    }

    func loadAndPrepare(
        provider: NSItemProvider,
        typeIdentifier: String,
        call: CAPPluginCall
    ) {
        provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { [weak self] sourceURL, error in
            guard let self else {
                call.reject(
                    WallpaperFailure.readFailed.message,
                    WallpaperFailure.readFailed.code,
                    error
                )
                return
            }

            guard let sourceURL else {
                let failure = WallpaperFailure(
                    code: WallpaperFailure.readFailed.code,
                    message: WallpaperFailure.readFailed.message,
                    underlying: error
                )
                self.finish(call, with: .failure(failure))
                return
            }

            let cachedSource: URL

            do {
                cachedSource = try self.copySourceToCache(sourceURL)
            } catch {
                self.finish(call, with: .failure(error))
                return
            }

            self.processingQueue.async { [weak self] in
                guard let self else {
                    try? FileManager.default.removeItem(at: cachedSource)
                    call.reject(
                        WallpaperFailure.processingFailed.message,
                        WallpaperFailure.processingFailed.code
                    )
                    return
                }

                let result: Result<PreparedWallpaper, Error> = autoreleasepool {
                    defer {
                        try? self.fileManager.removeItem(at: cachedSource)
                    }

                    return Result {
                        try self.prepareWallpaper(from: cachedSource)
                    }
                }

                self.finish(call, with: result)
            }
        }
    }

    func finish(_ call: CAPPluginCall, with result: Result<PreparedWallpaper, Error>) {
        DispatchQueue.main.async { [weak self] in
            self?.isBusy = false

            switch result {
            case .success(let wallpaper):
                call.resolve(with: wallpaper)
            case .failure(let error):
                let failure = WallpaperFailure.from(error)
                call.reject(failure.message, failure.code, failure.underlying ?? error)
            }
        }
    }

    func copySourceToCache(_ sourceURL: URL) throws -> URL {
        let accessStarted = sourceURL.startAccessingSecurityScopedResource()

        defer {
            if accessStarted {
                sourceURL.stopAccessingSecurityScopedResource()
            }
        }

        let destinationURL = fileManager.temporaryDirectory
            .appendingPathComponent("wallpaper-source-\(UUID().uuidString)", isDirectory: false)
        var readHandle: FileHandle?
        var writeHandle: FileHandle?
        var totalBytes = 0

        do {
            let resourceValues = try? sourceURL.resourceValues(forKeys: [
                .fileSizeKey,
                .isRegularFileKey
            ])

            if resourceValues?.isRegularFile == false {
                throw WallpaperFailure.readFailed
            }

            if let fileSize = resourceValues?.fileSize,
               fileSize > Self.maximumSourceBytes {
                throw WallpaperFailure.sourceTooLarge
            }

            readHandle = try FileHandle(forReadingFrom: sourceURL)

            guard fileManager.createFile(atPath: destinationURL.path, contents: nil) else {
                throw WallpaperFailure.readFailed
            }

            writeHandle = try FileHandle(forWritingTo: destinationURL)

            while true {
                let chunk = try readHandle?.read(upToCount: 64 * 1024) ?? Data()

                if chunk.isEmpty {
                    break
                }

                totalBytes += chunk.count

                if totalBytes > Self.maximumSourceBytes {
                    throw WallpaperFailure.sourceTooLarge
                }

                try writeHandle?.write(contentsOf: chunk)
            }

            guard totalBytes > 0 else {
                throw WallpaperFailure.emptySource
            }

            try writeHandle?.synchronize()
            try readHandle?.close()
            readHandle = nil
            try writeHandle?.close()
            writeHandle = nil
            return destinationURL
        } catch {
            try? readHandle?.close()
            try? writeHandle?.close()
            try? fileManager.removeItem(at: destinationURL)

            if error is WallpaperFailure {
                throw error
            }

            throw WallpaperFailure(
                code: WallpaperFailure.readFailed.code,
                message: WallpaperFailure.readFailed.message,
                underlying: error
            )
        }
    }

    func prepareWallpaper(from sourceURL: URL) throws -> PreparedWallpaper {
        guard let imageSource = CGImageSourceCreateWithURL(
            sourceURL as CFURL,
            [kCGImageSourceShouldCache: false] as CFDictionary
        ), CGImageSourceGetCount(imageSource) > 0 else {
            throw WallpaperFailure.unsupportedImage
        }

        if let sourceType = CGImageSourceGetType(imageSource),
           let uniformType = UTType(sourceType as String),
           !uniformType.conforms(to: .image) {
            throw WallpaperFailure.unsupportedImage
        }

        guard let properties = CGImageSourceCopyPropertiesAtIndex(
            imageSource,
            0,
            nil
        ) as? [CFString: Any],
        let sourceWidth = number(from: properties[kCGImagePropertyPixelWidth]),
        let sourceHeight = number(from: properties[kCGImagePropertyPixelHeight]),
        sourceWidth > 0,
        sourceHeight > 0 else {
            throw WallpaperFailure.unsupportedImage
        }

        let maximumPixelSize = calculateMaximumPixelSize(
            width: sourceWidth,
            height: sourceHeight,
            maximumEdge: Self.maximumMainEdge,
            maximumPixels: Self.maximumMainPixels
        )
        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize
        ]

        guard let transformedImage = CGImageSourceCreateThumbnailAtIndex(
            imageSource,
            0,
            thumbnailOptions as CFDictionary
        ) else {
            throw WallpaperFailure.decodeFailed
        }

        let mainImage = try renderRGBImage(
            transformedImage,
            width: transformedImage.width,
            height: transformedImage.height
        )
        let blurDimensions = calculateDimensions(
            width: mainImage.width,
            height: mainImage.height,
            maximumEdge: Self.maximumBlurEdge,
            maximumPixels: Self.maximumBlurPixels
        )
        let blurImage = try renderRGBImage(
            mainImage,
            width: blurDimensions.width,
            height: blurDimensions.height
        )
        let mainEncoded = try encodeWithinLimit(
            mainImage,
            maximumBytes: Self.maximumMainBytes,
            qualities: Self.mainQualities
        )
        let blurEncoded = try encodeWithinLimit(
            blurImage,
            maximumBytes: Self.maximumBlurBytes,
            qualities: Self.blurQualities
        )

        return try store(main: mainEncoded, blur: blurEncoded)
    }

    func number(from value: Any?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }

    func calculateMaximumPixelSize(
        width: Double,
        height: Double,
        maximumEdge: Int,
        maximumPixels: Int
    ) -> Int {
        let longestEdge = max(width, height)
        let edgeScale = Double(maximumEdge) / longestEdge
        let pixelScale = sqrt(Double(maximumPixels) / (width * height))
        let scale = min(1, edgeScale, pixelScale)
        return max(1, Int((longestEdge * scale).rounded()))
    }

    func calculateDimensions(
        width: Int,
        height: Int,
        maximumEdge: Int,
        maximumPixels: Int
    ) -> Dimensions {
        let edgeScale = Double(maximumEdge) / Double(max(width, height))
        let pixelScale = sqrt(
            Double(maximumPixels) / (Double(width) * Double(height))
        )
        let scale = min(1, edgeScale, pixelScale)

        return Dimensions(
            width: max(1, Int((Double(width) * scale).rounded())),
            height: max(1, Int((Double(height) * scale).rounded()))
        )
    }

    func renderRGBImage(_ source: CGImage, width: Int, height: Int) throws -> CGImage {
        guard width > 0,
              height > 0,
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                  data: nil,
                  width: width,
                  height: height,
                  bitsPerComponent: 8,
                  bytesPerRow: width * 4,
                  space: colorSpace,
                  bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue |
                      CGImageAlphaInfo.noneSkipLast.rawValue
              ) else {
            throw WallpaperFailure.decodeFailed
        }

        context.setFillColor(red: 0, green: 0, blue: 0, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))

        guard let image = context.makeImage() else {
            throw WallpaperFailure.decodeFailed
        }

        return image
    }

    func encodeWithinLimit(
        _ source: CGImage,
        maximumBytes: Int,
        qualities: [CGFloat]
    ) throws -> EncodedWallpaper {
        var currentImage = source

        for resizeAttempt in 0..<Self.resizeAttempts {
            for quality in qualities {
                let data = try encodeJPEG(currentImage, quality: quality)

                if data.count <= maximumBytes {
                    return EncodedWallpaper(
                        data: data,
                        width: currentImage.width,
                        height: currentImage.height
                    )
                }
            }

            if resizeAttempt < Self.resizeAttempts - 1 {
                let nextWidth = max(
                    1,
                    Int((Double(currentImage.width) * Self.resizeFactor).rounded())
                )
                let nextHeight = max(
                    1,
                    Int((Double(currentImage.height) * Self.resizeFactor).rounded())
                )
                currentImage = try renderRGBImage(
                    currentImage,
                    width: nextWidth,
                    height: nextHeight
                )
            }
        }

        throw WallpaperFailure.outputTooLarge
    }

    func encodeJPEG(_ image: CGImage, quality: CGFloat) throws -> Data {
        let output = NSMutableData()

        guard let destination = CGImageDestinationCreateWithData(
            output,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            throw WallpaperFailure.encodeFailed
        }

        // Only the encoder quality is supplied. No source properties are copied,
        // so EXIF, location and other source metadata cannot reach the saved JPEG.
        CGImageDestinationAddImage(
            destination,
            image,
            [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
        )

        guard CGImageDestinationFinalize(destination), output.length > 0 else {
            throw WallpaperFailure.encodeFailed
        }

        return output as Data
    }

    func store(
        main: EncodedWallpaper,
        blur: EncodedWallpaper
    ) throws -> PreparedWallpaper {
        guard let documentsDirectory = fileManager.urls(
            for: .documentDirectory,
            in: .userDomainMask
        ).first else {
            throw WallpaperFailure.writeFailed
        }

        let directory = documentsDirectory.appendingPathComponent(
            "wallpapers",
            isDirectory: true
        )

        do {
            try fileManager.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
        } catch {
            throw WallpaperFailure(
                code: WallpaperFailure.writeFailed.code,
                message: WallpaperFailure.writeFailed.message,
                underlying: error
            )
        }

        let revision = UUID().uuidString.lowercased()
        let mainFileName = "\(revision)-main.jpg"
        let blurFileName = "\(revision)-blur.jpg"
        let mainURL = directory.appendingPathComponent(mainFileName, isDirectory: false)
        let blurURL = directory.appendingPathComponent(blurFileName, isDirectory: false)
        let mainTemporaryURL = directory.appendingPathComponent(
            ".\(revision)-main.jpg.tmp",
            isDirectory: false
        )
        let blurTemporaryURL = directory.appendingPathComponent(
            ".\(revision)-blur.jpg.tmp",
            isDirectory: false
        )

        do {
            try writeAndVerify(main.data, to: mainTemporaryURL)
            try writeAndVerify(blur.data, to: blurTemporaryURL)
            try fileManager.moveItem(at: mainTemporaryURL, to: mainURL)
            try fileManager.moveItem(at: blurTemporaryURL, to: blurURL)

            let storedMainBytes = try fileSize(at: mainURL)
            let storedBlurBytes = try fileSize(at: blurURL)

            guard storedMainBytes == main.data.count,
                  storedBlurBytes == blur.data.count else {
                throw WallpaperFailure.writeFailed
            }

            return PreparedWallpaper(
                blur: WallpaperAsset(
                    bytes: storedBlurBytes,
                    height: blur.height,
                    mimeType: "image/jpeg",
                    path: "wallpapers/\(blurFileName)",
                    width: blur.width
                ),
                main: WallpaperAsset(
                    bytes: storedMainBytes,
                    height: main.height,
                    mimeType: "image/jpeg",
                    path: "wallpapers/\(mainFileName)",
                    width: main.width
                )
            )
        } catch {
            for url in [mainTemporaryURL, blurTemporaryURL, mainURL, blurURL] {
                try? fileManager.removeItem(at: url)
            }

            if let failure = error as? WallpaperFailure {
                throw failure
            }

            throw WallpaperFailure(
                code: WallpaperFailure.writeFailed.code,
                message: WallpaperFailure.writeFailed.message,
                underlying: error
            )
        }
    }

    func writeAndVerify(_ data: Data, to url: URL) throws {
        guard !data.isEmpty else {
            throw WallpaperFailure.writeFailed
        }

        try data.write(to: url, options: .atomic)

        guard try fileSize(at: url) == data.count else {
            throw WallpaperFailure.writeFailed
        }
    }

    func fileSize(at url: URL) throws -> Int {
        let attributes = try fileManager.attributesOfItem(atPath: url.path)

        guard let size = attributes[.size] as? NSNumber,
              size.intValue > 0 else {
            throw WallpaperFailure.writeFailed
        }

        return size.intValue
    }
}

private struct Dimensions {
    let width: Int
    let height: Int
}

private struct EncodedWallpaper {
    let data: Data
    let width: Int
    let height: Int
}

private struct PreparedWallpaper: Encodable {
    let blur: WallpaperAsset
    let main: WallpaperAsset
}

private struct WallpaperAsset: Encodable {
    let bytes: Int
    let height: Int
    let mimeType: String
    let path: String
    let width: Int
}

private struct WallpaperFailure: Error {
    let code: String
    let message: String
    let underlying: Error?

    init(code: String, message: String, underlying: Error? = nil) {
        self.code = code
        self.message = message
        self.underlying = underlying
    }

    static let pickerBusy = WallpaperFailure(
        code: "WALLPAPER_PICKER_BUSY",
        message: "正在处理上一张背景图片，请稍候。"
    )
    static let pickerUnavailable = WallpaperFailure(
        code: "WALLPAPER_PICKER_UNAVAILABLE",
        message: "没能打开图片选择器，请稍后再试。"
    )
    static let pickerCancelled = WallpaperFailure(
        code: "WALLPAPER_PICKER_CANCELLED",
        message: "已取消选择图片。"
    )
    static let readFailed = WallpaperFailure(
        code: "WALLPAPER_READ_FAILED",
        message: "没能读取所选图片，请重新选择。"
    )
    static let sourceTooLarge = WallpaperFailure(
        code: "WALLPAPER_SOURCE_TOO_LARGE",
        message: "图片不能超过 30 MB。"
    )
    static let emptySource = WallpaperFailure(
        code: "WALLPAPER_EMPTY_SOURCE",
        message: "这张图片是空文件，请重新选择。"
    )
    static let unsupportedImage = WallpaperFailure(
        code: "WALLPAPER_UNSUPPORTED_IMAGE",
        message: "这张图片无法识别。请选择 JPEG、PNG、WebP 或 HEIF 格式的图片。"
    )
    static let decodeFailed = WallpaperFailure(
        code: "WALLPAPER_DECODE_FAILED",
        message: "这张图片无法读取，请换一张或转换格式后再试。"
    )
    static let encodeFailed = WallpaperFailure(
        code: "WALLPAPER_ENCODE_FAILED",
        message: "没能保存处理后的背景图片，请重试。"
    )
    static let outputTooLarge = WallpaperFailure(
        code: "WALLPAPER_OUTPUT_TOO_LARGE",
        message: "压缩后的图片还是太大，请换张图片再试。"
    )
    static let writeFailed = WallpaperFailure(
        code: "WALLPAPER_WRITE_FAILED",
        message: "保存背景图片失败，请确认手机存储空间充足后重试。"
    )
    static let processingFailed = WallpaperFailure(
        code: "WALLPAPER_PROCESSING_FAILED",
        message: "处理背景图片时出了点问题，请换张图片再试。"
    )

    static func from(_ error: Error) -> WallpaperFailure {
        if let failure = error as? WallpaperFailure {
            return failure
        }

        return WallpaperFailure(
            code: processingFailed.code,
            message: processingFailed.message,
            underlying: error
        )
    }
}
