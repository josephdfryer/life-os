import Foundation
import LifeOSCompanionCore

@main
struct CompanionHelper {
    static func main() async {
        let logger = RedactedLogger(category: "helper")
        do {
            let outbox = try EncryptedOutbox(databaseURL: CompanionPaths.applicationSupport().appending(path: "collector.sqlite"))
            let api = try APIClient(baseURL: URL(string: "https://api.lacollecteur.com/")!)
            let scheduler = UploadScheduler(outbox: outbox, api: api)
            let collector = MacCollector(outbox: outbox, api: api)
            while !Task.isCancelled {
                let paused = UserDefaults(suiteName: "com.lacollecteur.lifeos.companion.shared")?.bool(forKey: "collection-paused") ?? false
                if !paused {
                    do { try await collector.collectOnce() } catch { logger.error(code: "collection_retryable") }
                    do { _ = try await scheduler.runOnce() } catch { logger.error(code: "upload_retryable") }
                }
                try await Task.sleep(for: .seconds(300))
            }
        } catch { logger.error(code: "helper_start_failed") }
    }
}
