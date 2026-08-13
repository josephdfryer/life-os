import AppKit
import AuthenticationServices
import CryptoKit
import Foundation
import ServiceManagement
import LifeOSCompanionCore

@MainActor
final class MacCompanionModel: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var signedIn = false
    @Published var isPaused = UserDefaults(suiteName: "com.lacollecteur.lifeos.companion.shared")?.bool(forKey: "collection-paused") ?? false
    @Published var pendingCount = 0
    @Published var lastSuccessfulSync: Date?
    @Published var errorCode: String?
    @Published var statuses = [
        ConnectorStatus(source: .imessage), ConnectorStatus(source: .whatsapp), ConnectorStatus(source: .documents),
        ConnectorStatus(source: .voiceJournal), ConnectorStatus(source: .photos), ConnectorStatus(source: .callHistory),
    ]
    private var api: APIClient?
    private var outbox: EncryptedOutbox?
    private var scheduler: UploadScheduler?
    private var authSession: ASWebAuthenticationSession?

    override init() { super.init(); Task { await configure() } }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor() }

    func configure() async {
        do {
            let store = try EncryptedOutbox(databaseURL: CompanionPaths.applicationSupport().appending(path: "collector.sqlite"))
            let client = try APIClient(baseURL: URL(string: "https://api.lacollecteur.com/")!)
            outbox = store; api = client; scheduler = UploadScheduler(outbox: store, api: client)
            signedIn = await client.isSignedIn; pendingCount = try await store.pendingCount()
            try? SMAppService.loginItem(identifier: "com.lacollecteur.lifeos.companion.helper").register()
        } catch { errorCode = "foundation_unavailable" }
    }

    func signIn() {
        let verifier = Self.randomBase64URL(count: 64); let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
        let state = Self.randomBase64URL(count: 32); UserDefaults.standard.set(verifier, forKey: "auth-verifier"); UserDefaults.standard.set(state, forKey: "auth-state")
        var parts = URLComponents(string: "https://home.lacollecteur.com/device/authorize")!
        parts.queryItems = [URLQueryItem(name: "platform", value: "macos"), URLQueryItem(name: "device_name", value: Host.current().localizedName ?? "Mac"), URLQueryItem(name: "app_version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"), URLQueryItem(name: "redirect_uri", value: "lifeos-companion://auth/callback"), URLQueryItem(name: "code_challenge", value: challenge), URLQueryItem(name: "state", value: state)]
        let session = ASWebAuthenticationSession(url: parts.url!, callbackURLScheme: "lifeos-companion") { [weak self] url, error in Task { @MainActor in
            guard error == nil, let self, let url, let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
                  query.first(where: { $0.name == "state" })?.value == state,
                  let code = query.first(where: { $0.name == "code" })?.value,
                  let deviceId = query.first(where: { $0.name == "device_id" })?.value, let api = self.api else { self?.errorCode = "sign_in_cancelled"; return }
            do { try await api.exchange(code: code, verifier: verifier, deviceId: deviceId); self.signedIn = true; self.errorCode = nil } catch { self.errorCode = "exchange_failed" }
        } }
        session.presentationContextProvider = self; session.prefersEphemeralWebBrowserSession = false; authSession = session; session.start()
    }

    func togglePause() { isPaused.toggle(); UserDefaults(suiteName: "com.lacollecteur.lifeos.companion.shared")?.set(isPaused, forKey: "collection-paused") }
    func syncNow() async { guard !isPaused, let scheduler else { return }; do { _ = try await scheduler.runOnce(); pendingCount = try await outbox?.pendingCount() ?? 0; lastSuccessfulSync = Date(); errorCode = nil } catch { errorCode = "sync_failed" } }
    func setEnabled(_ source: ConnectorSource, enabled: Bool) { guard let index = statuses.firstIndex(where: { $0.source == source }) else { return }; statuses[index].enabled = enabled; statuses[index].healthStatus = enabled ? .healthy : .paused; Task { try? await api?.heartbeat(appVersion: "1.0", sources: statuses) } }
    func repairBackgroundService() { do { try SMAppService.loginItem(identifier: "com.lacollecteur.lifeos.companion.helper").register(); errorCode = nil } catch { errorCode = "background_approval_required"; SMAppService.openSystemSettingsLoginItems() } }
    static func randomBase64URL(count: Int) -> String { Data((0..<count).map { _ in UInt8.random(in: .min ... .max) }).base64URLEncodedString() }
}

private extension Data { func base64URLEncodedString() -> String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") } }
