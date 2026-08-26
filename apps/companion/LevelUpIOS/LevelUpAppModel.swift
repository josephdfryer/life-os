import AuthenticationServices
import CryptoKit
import Foundation
import LifeOSCompanionCore
import UIKit

@MainActor
final class LevelUpAppModel: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published private(set) var signedIn = false
    @Published private(set) var isStarting = true
    @Published var errorMessage: String?
    private(set) var api: APIClient?
    private var authSession: ASWebAuthenticationSession?

    func start() async {
        guard api == nil else {
            isStarting = false
            return
        }
        do {
            let client = try APIClient(
                baseURL: URL(string: "https://api.lacollecteur.com/")!,
                keychain: KeychainStore(service: "com.lacollecteur.levelup")
            )
            api = client
            signedIn = await client.isSignedIn
            isStarting = false
        } catch {
            isStarting = false
            errorMessage = "Level Up could not open its secure credential store."
        }
    }

    func connect() {
        let verifier = randomToken(byteCount: 64)
        let state = randomToken(byteCount: 32)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var url = URLComponents(string: "https://home.lacollecteur.com/device/authorize")!
        url.queryItems = [
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "device_name", value: "Level Up on \(UIDevice.current.name)"),
            URLQueryItem(name: "app_version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"),
            URLQueryItem(name: "redirect_uri", value: "levelup://auth/callback"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "state", value: state),
        ]

        let session = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: "levelup") { [weak self] callback, error in
            Task { @MainActor in
                guard error == nil,
                      let self,
                      let callback,
                      let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
                      items.first(where: { $0.name == "state" })?.value == state,
                      let code = items.first(where: { $0.name == "code" })?.value,
                      let deviceId = items.first(where: { $0.name == "device_id" })?.value,
                      let api = self.api else {
                    self?.errorMessage = "Connection was cancelled."
                    return
                }
                do {
                    try await api.exchange(code: code, verifier: verifier, deviceId: deviceId)
                    self.signedIn = true
                    self.errorMessage = nil
                } catch {
                    self.errorMessage = "Level Up could not finish connecting to your workspace."
                }
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = true
        authSession = session
        session.start()
    }

    func signOut() async {
        do {
            try await api?.signOut()
            signedIn = false
        } catch {
            errorMessage = "Level Up could not clear the local credential."
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first ?? ASPresentationAnchor()
    }
}

private func randomToken(byteCount: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return Data(bytes).base64URL
}

private extension Data {
    var base64URL: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
