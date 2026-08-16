import AuthenticationServices
import BackgroundTasks
import CryptoKit
import Foundation
import LifeOSCompanionCore
import UIKit

enum PersonsBackground {
    static let refreshTaskId = "com.lacollecteur.persons.refresh"

    static func nextEndOfDay(now: Date = Date(), calendar: Calendar = .current) -> Date {
        var components = calendar.dateComponents([.year, .month, .day], from: now)
        components.hour = 23
        components.minute = 50
        let today = calendar.date(from: components) ?? now
        return today > now ? today : calendar.date(byAdding: .day, value: 1, to: today) ?? today
    }
}

@MainActor
final class PersonsAppModel: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var signedIn = false
    @Published var errorMessage: String?
    @Published var contactsStatus = ConnectorStatus(source: .contacts)
    @Published var pendingCount = 0
    @Published var lastSync: Date?
    @Published var isSyncing = false
    @Published var syncMessage = "Ready to sync"
    @Published var errorCode: String?
    private(set) var api: APIClient?
    private(set) var outbox: EncryptedOutbox?
    private var scheduler: UploadScheduler?
    private var authSession: ASWebAuthenticationSession?
    lazy var contacts = ContactsConnector(model: self)

    func start() async {
        guard api == nil else { return }
        do {
            let root = try CompanionPaths.applicationSupport()
            let store = try EncryptedOutbox(databaseURL: root.appending(path: "persons-companion.sqlite"))
            let client = try APIClient(
                baseURL: URL(string: "https://api.lacollecteur.com/")!,
                keychain: KeychainStore(service: "com.lacollecteur.persons")
            )
            outbox = store
            api = client
            scheduler = UploadScheduler(outbox: store, api: client)
            signedIn = await client.isSignedIn
            pendingCount = try await store.pendingCount()
            refreshConnectorStatuses()
            scheduleEndOfDayRefresh()
            if signedIn, contactsStatus.enabled {
                await runSync()
            }
        } catch {
            errorMessage = "Persons could not open its secure credential store."
        }
    }

    func connect() {
        let verifier = randomToken(64)
        let state = randomToken(32)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var url = URLComponents(string: "https://home.lacollecteur.com/device/authorize")!
        url.queryItems = [
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "device_name", value: "Persons on \(UIDevice.current.name)"),
            URLQueryItem(name: "app_version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"),
            URLQueryItem(name: "redirect_uri", value: "persons://auth/callback"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "state", value: state),
        ]
        let session = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: "persons") { [weak self] callback, error in
            Task { @MainActor in
                guard error == nil,
                      let self,
                      let callback,
                      let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
                      items.first(where: { $0.name == "state" })?.value == state,
                      let code = items.first(where: { $0.name == "code" })?.value,
                      let device = items.first(where: { $0.name == "device_id" })?.value,
                      let api = self.api else {
                    self?.errorMessage = "Connection was cancelled."
                    return
                }
                do {
                    try await api.exchange(code: code, verifier: verifier, deviceId: device)
                    self.signedIn = true
                    self.errorMessage = nil
                } catch {
                    self.errorMessage = "Persons could not finish connecting to your workspace."
                }
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        session.start()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first ?? ASPresentationAnchor()
    }

    func enableContacts() async {
        do {
            syncMessage = "Requesting Contacts access…"
            try await contacts.authorizeAndStart()
            contactsStatus.enabled = true
            contactsStatus.permissionStatus = .granted
            contactsStatus.healthStatus = .healthy
            UserDefaults.standard.set(true, forKey: "persons.contacts.enabled")
            scheduleEndOfDayRefresh()
            await runSync()
        } catch {
            contactsStatus.healthStatus = .error
            contactsStatus.permissionStatus = .denied
            contactsStatus.lastErrorCode = "contacts_permission_denied"
            syncMessage = "Contacts access needs attention"
        }
    }

    func syncNow() async { await runSync() }
    func backgroundRefresh() async {
        await runSync()
        scheduleEndOfDayRefresh()
    }

    func enqueue(_ item: OutboxItem) async {
        do {
            try await outbox?.enqueue(item)
            pendingCount = try await outbox?.pendingCount() ?? 0
        } catch {
            errorCode = "outbox_write_failed"
        }
    }

    func scheduleEndOfDayRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: PersonsBackground.refreshTaskId)
        request.earliestBeginDate = PersonsBackground.nextEndOfDay()
        try? BGTaskScheduler.shared.submit(request)
    }

    private func refreshConnectorStatuses() {
        if UserDefaults.standard.bool(forKey: "persons.contacts.enabled") {
            contactsStatus.enabled = true
            contactsStatus.permissionStatus = .granted
        }
    }

    private func runSync() async {
        guard !isSyncing else {
            syncMessage = "Sync already in progress"
            return
        }
        isSyncing = true
        defer { isSyncing = false }

        do {
            if contactsStatus.enabled {
                syncMessage = "Checking Contacts for changes…"
                await contacts.collectIncremental()
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

    private func sendHeartbeat() async throws {
        try await api?.heartbeat(appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0", sources: [contactsStatus])
    }

    private func randomToken(_ count: Int) -> String {
        Data((0..<count).map { _ in UInt8.random(in: .min ... .max) }).base64URL
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private extension UIWindowScene {
    var keyWindow: UIWindow? { windows.first(where: \.isKeyWindow) }
}
