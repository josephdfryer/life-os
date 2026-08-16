import AuthenticationServices
import BackgroundTasks
import CryptoKit
import Foundation
import UIKit
import LifeOSCompanionCore

enum CompanionBackground {
    static let refreshTaskId = "com.lacollecteur.lifeos.companion.refresh"

    static func nextEndOfDay(now: Date = Date(), calendar: Calendar = .current) -> Date {
        var components = calendar.dateComponents([.year, .month, .day], from: now)
        components.hour = 23
        components.minute = 50
        let today = calendar.date(from: components) ?? now
        return today > now ? today : calendar.date(byAdding: .day, value: 1, to: today) ?? today
    }
}

@MainActor
final class IOSCompanionModel: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var signedIn = false
    @Published var healthStatus = ConnectorStatus(source: .healthkit)
    @Published var locationStatus = ConnectorStatus(source: .location)
    @Published var photoStatus = ConnectorStatus(source: .photos)
    @Published var pendingCount = 0
    @Published var lastSync: Date?
    @Published var errorCode: String?
    @Published var isSyncing = false
    @Published var syncMessage = "Ready to sync"
    private(set) var api: APIClient?
    private(set) var outbox: EncryptedOutbox?
    private var scheduler: UploadScheduler?
    private var authSession: ASWebAuthenticationSession?
    lazy var health = HealthConnector(model: self)
    lazy var location = LocationConnector(model: self)
    lazy var photos = PhotoConnector(model: self)

    func start() async {
        guard api == nil else { return }
        do {
            let root = try CompanionPaths.applicationSupport(); let store = try EncryptedOutbox(databaseURL: root.appending(path: "companion.sqlite")); let client = try APIClient(baseURL: URL(string: "https://api.lacollecteur.com/")!)
            outbox = store; api = client; scheduler = UploadScheduler(outbox: store, api: client); signedIn = await client.isSignedIn; pendingCount = try await store.pendingCount()
            await refreshConnectorStatuses()
            scheduleEndOfDayRefresh()
            if signedIn { await resumeAuthorizedConnectors(); await sync() }
        } catch { errorCode = "foundation_unavailable" }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor() }
    func signIn() {
        let verifier = randomToken(64), state = randomToken(32), challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var url = URLComponents(string: "https://home.lacollecteur.com/device/authorize")!; url.queryItems = [URLQueryItem(name: "platform", value: "ios"), URLQueryItem(name: "device_name", value: UIDevice.current.name), URLQueryItem(name: "app_version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"), URLQueryItem(name: "redirect_uri", value: "lifeos-companion://auth/callback"), URLQueryItem(name: "code_challenge", value: challenge), URLQueryItem(name: "state", value: state)]
        let session = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: "lifeos-companion") { [weak self] callback, error in Task { @MainActor in
            guard error == nil, let self, let callback, let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems, items.first(where: { $0.name == "state" })?.value == state, let code = items.first(where: { $0.name == "code" })?.value, let device = items.first(where: { $0.name == "device_id" })?.value, let api = self.api else { self?.errorCode = "sign_in_cancelled"; return }
            do { try await api.exchange(code: code, verifier: verifier, deviceId: device); self.signedIn = true; await self.refreshConnectorStatuses(); await self.sync() } catch { self.errorCode = "exchange_failed" }
        } }; session.presentationContextProvider = self; session.prefersEphemeralWebBrowserSession = false; authSession = session; session.start()
    }
    func enableHealth() async {
        do {
            syncMessage = "Requesting Health access…"
            try await health.authorizeAndStart()
            healthStatus.enabled = true
            healthStatus.permissionStatus = .granted
            healthStatus.healthStatus = .healthy
            scheduleEndOfDayRefresh()
            await sync()
        } catch {
            healthStatus.healthStatus = .error
            healthStatus.lastErrorCode = "health_permission_or_query"
            syncMessage = "Health setup needs attention"
        }
    }
    func enableLocation() { location.start(); locationStatus.enabled = true }
    func enablePhotos() async { await photos.authorizeAndStart(); await sync() }
    func syncNow() async { await runSync(collectHealth: healthStatus.enabled, collectPhotos: photoStatus.enabled) }
    func sync() async { await runSync(collectHealth: false, collectPhotos: false) }
    func syncHealthFromObserver() async { await runSync(collectHealth: healthStatus.enabled, collectPhotos: false) }
    func syncSleepFromObserver() async { await runSync(collectSleep: healthStatus.enabled) }
    func syncWorkoutsFromObserver() async { await runSync(collectWorkouts: healthStatus.enabled) }
    func backgroundRefresh() async {
        await runSync(collectHealth: healthStatus.enabled, collectPhotos: photoStatus.enabled)
        scheduleEndOfDayRefresh()
    }
    func scheduleEndOfDayRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: CompanionBackground.refreshTaskId)
        request.earliestBeginDate = CompanionBackground.nextEndOfDay()
        try? BGTaskScheduler.shared.submit(request)
    }
    func enqueue(_ item: OutboxItem) async { do { try await outbox?.enqueue(item); pendingCount = try await outbox?.pendingCount() ?? 0 } catch { errorCode = "outbox_write_failed" } }
    private func refreshConnectorStatuses() async {
        location.refreshStatus()
        photos.refreshStatus()
        if UserDefaults.standard.bool(forKey: "lifeos.health.enabled") {
            healthStatus.enabled = true
            healthStatus.permissionStatus = .granted
        }
    }
    private func resumeAuthorizedConnectors() async {
        if healthStatus.enabled {
            do {
                try await health.authorizeAndStart()
                healthStatus.healthStatus = .healthy
            } catch {
                healthStatus.healthStatus = .degraded
                healthStatus.lastErrorCode = "health_resume_failed"
            }
        }
        location.resumeIfAuthorized()
        if photoStatus.enabled { await photos.collectIncremental() }
    }
    private func runSync(collectHealth: Bool = false, collectPhotos: Bool = false, collectSleep: Bool = false, collectWorkouts: Bool = false) async {
        guard !isSyncing else {
            syncMessage = "Sync already in progress"
            return
        }
        isSyncing = true
        defer { isSyncing = false }

        do {
            if collectHealth {
                syncMessage = "Collecting Health summaries…"
                await health.collectIncremental()
            } else if collectSleep {
                syncMessage = "Collecting last night's sleep…"
                await health.collectSleep()
            } else if collectWorkouts {
                syncMessage = "Collecting workouts…"
                await health.collectWorkouts()
            }
            if collectPhotos {
                syncMessage = "Checking new photo metadata…"
                await photos.collectIncremental()
            }

            syncMessage = "Uploading securely…"
            var uploaded = 0
            for _ in 0..<5 {
                let completed = try await scheduler?.runOnce() ?? 0
                uploaded += completed
                if completed == 0 { break }
            }
            pendingCount = try await outbox?.pendingCount() ?? 0
            lastSync = Date()
            errorCode = nil
            syncMessage = pendingCount == 0
                ? (uploaded == 0 ? "Everything is up to date" : "Synced \(uploaded) records")
                : "Synced \(uploaded); \(pendingCount) waiting to retry"

            do {
                try await sendHeartbeat()
            } catch {
                errorCode = "heartbeat_retryable"
                syncMessage += "; status update will retry"
            }
        } catch {
            pendingCount = (try? await outbox?.pendingCount()) ?? pendingCount
            errorCode = "sync_retryable"
            syncMessage = "Sync paused; \(pendingCount) records will retry"
        }
    }
    private func sendHeartbeat() async throws { try await api?.heartbeat(appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0", sources: [healthStatus, locationStatus, photoStatus]) }
    private func randomToken(_ count: Int) -> String { Data((0..<count).map { _ in UInt8.random(in: .min ... .max) }).base64URL }
}
private extension Data { var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") } }
private extension UIWindowScene { var keyWindow: UIWindow? { windows.first(where: \.isKeyWindow) } }
