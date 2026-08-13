import AuthenticationServices
import BackgroundTasks
import CryptoKit
import Foundation
import UIKit
import LifeOSCompanionCore

@MainActor
final class IOSCompanionModel: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var signedIn = false
    @Published var healthStatus = ConnectorStatus(source: .healthkit)
    @Published var locationStatus = ConnectorStatus(source: .location)
    @Published var pendingCount = 0
    @Published var lastSync: Date?
    @Published var errorCode: String?
    private(set) var api: APIClient?
    private(set) var outbox: EncryptedOutbox?
    private var scheduler: UploadScheduler?
    private var authSession: ASWebAuthenticationSession?
    lazy var health = HealthConnector(model: self)
    lazy var location = LocationConnector(model: self)

    func start() async {
        guard api == nil else { return }
        do {
            let root = try CompanionPaths.applicationSupport(); let store = try EncryptedOutbox(databaseURL: root.appending(path: "companion.sqlite")); let client = try APIClient(baseURL: URL(string: "https://api.lacollecteur.com/")!)
            outbox = store; api = client; scheduler = UploadScheduler(outbox: store, api: client); signedIn = await client.isSignedIn; pendingCount = try await store.pendingCount()
            if signedIn { await enableHealth(); enableLocation(); await sync() }
        } catch { errorCode = "foundation_unavailable" }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor() }
    func signIn() {
        let verifier = randomToken(64), state = randomToken(32), challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var url = URLComponents(string: "https://home.lacollecteur.com/device/authorize")!; url.queryItems = [URLQueryItem(name: "platform", value: "ios"), URLQueryItem(name: "device_name", value: UIDevice.current.name), URLQueryItem(name: "app_version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"), URLQueryItem(name: "redirect_uri", value: "lifeos-companion://auth/callback"), URLQueryItem(name: "code_challenge", value: challenge), URLQueryItem(name: "state", value: state)]
        let session = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: "lifeos-companion") { [weak self] callback, error in Task { @MainActor in
            guard error == nil, let self, let callback, let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems, items.first(where: { $0.name == "state" })?.value == state, let code = items.first(where: { $0.name == "code" })?.value, let device = items.first(where: { $0.name == "device_id" })?.value, let api = self.api else { self?.errorCode = "sign_in_cancelled"; return }
            do { try await api.exchange(code: code, verifier: verifier, deviceId: device); self.signedIn = true; await self.enableHealth(); self.enableLocation(); await self.sync() } catch { self.errorCode = "exchange_failed" }
        } }; session.presentationContextProvider = self; session.prefersEphemeralWebBrowserSession = false; authSession = session; session.start()
    }
    func enableHealth() async { do { try await health.authorizeAndStart(); healthStatus.enabled = true; healthStatus.permissionStatus = .granted; healthStatus.healthStatus = .healthy } catch { healthStatus.healthStatus = .error; healthStatus.lastErrorCode = "health_permission_or_query" } }
    func enableLocation() { location.start(); locationStatus.enabled = true }
    func sync() async { do { _ = try await scheduler?.runOnce(); pendingCount = try await outbox?.pendingCount() ?? 0; lastSync = Date(); try await sendHeartbeat(); errorCode = nil } catch { errorCode = "sync_retryable" } }
    func backgroundRefresh() async { await health.collectIncremental(); await sync() }
    func enqueue(_ item: OutboxItem) async { do { try await outbox?.enqueue(item); pendingCount = try await outbox?.pendingCount() ?? 0 } catch { errorCode = "outbox_write_failed" } }
    private func sendHeartbeat() async throws { try await api?.heartbeat(appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0", sources: [healthStatus, locationStatus]) }
    private func randomToken(_ count: Int) -> String { Data((0..<count).map { _ in UInt8.random(in: .min ... .max) }).base64URL }
}
private extension Data { var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") } }
private extension UIWindowScene { var keyWindow: UIWindow? { windows.first(where: \.isKeyWindow) } }
