import Foundation
import LifeOSCompanionCore
import Photos

@MainActor
final class PhotoConnector {
    private weak var model: IOSCompanionModel?

    init(model: IOSCompanionModel) {
        self.model = model
    }

    func refreshStatus() {
        guard let model else { return }
        switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
        case .authorized:
            model.photoStatus.enabled = true
            model.photoStatus.permissionStatus = .granted
            model.photoStatus.healthStatus = .healthy
        case .limited:
            model.photoStatus.enabled = true
            model.photoStatus.permissionStatus = .limited
            model.photoStatus.healthStatus = .healthy
        case .denied, .restricted:
            model.photoStatus.enabled = false
            model.photoStatus.permissionStatus = .denied
            model.photoStatus.healthStatus = .error
            model.photoStatus.lastErrorCode = "photos_authorization"
        case .notDetermined:
            model.photoStatus.enabled = false
            model.photoStatus.permissionStatus = .notRequested
            model.photoStatus.healthStatus = .unknown
        @unknown default:
            model.photoStatus.enabled = false
            model.photoStatus.permissionStatus = .unknown
            model.photoStatus.healthStatus = .unknown
        }
    }

    func authorizeAndStart() async {
        _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        refreshStatus()
        guard model?.photoStatus.enabled == true else { return }
        await collectIncremental()
    }

    func collectIncremental() async {
        guard let model, let outbox = model.outbox, let deviceId = await model.api?.deviceId else { return }
        do {
            guard let checkpoint = try await outbox.checkpoint(Date.self, source: .photos) else {
                // Deliberately start at consent time. Importing the existing library
                // requires a separate bounded preview and explicit confirmation.
                try await outbox.setCheckpoint(Date(), source: .photos)
                model.photoStatus.lastSuccessAt = Date()
                return
            }

            let options = PHFetchOptions()
            options.predicate = NSPredicate(format: "creationDate > %@", checkpoint as NSDate)
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
            let assets = PHAsset.fetchAssets(with: options)
            var newest = checkpoint
            var items: [OutboxItem] = []
            assets.enumerateObjects { asset, _, _ in
                guard let capturedAt = asset.creationDate else { return }
                newest = max(newest, capturedAt)
                let mediaType = asset.mediaType == .video ? "video" : "photo"
                let record = NormalizedRecord(type: "photo.metadata", fields: [
                    "capturedAt": .string(capturedAt.ISO8601Format()),
                    "mediaType": .string(mediaType),
                    "favorite": .bool(asset.isFavorite),
                    "latitude": asset.location.map { .number($0.coordinate.latitude) } ?? .null,
                    "longitude": asset.location.map { .number($0.coordinate.longitude) } ?? .null,
                    "caption": .null,
                ])
                items.append(OutboxItem(deviceId: deviceId, source: .photos, sourceId: asset.localIdentifier, observedAt: capturedAt, record: record))
            }
            for item in items { await model.enqueue(item) }
            try await outbox.setCheckpoint(newest, source: .photos)
            model.photoStatus.lastSuccessAt = Date()
            model.photoStatus.healthStatus = .healthy
        } catch {
            model.photoStatus.healthStatus = .degraded
            model.photoStatus.lastErrorCode = "photos_metadata_query"
        }
    }
}
