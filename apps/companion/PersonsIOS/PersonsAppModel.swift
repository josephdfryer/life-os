import AuthenticationServices
import CryptoKit
import Foundation
import LifeOSCompanionCore
import UIKit

@MainActor
final class PersonsAppModel: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var signedIn = false
    @Published var errorMessage: String?
    private(set) var api: APIClient?
    private var authSession: ASWebAuthenticationSession?

    func start() async {
        guard api == nil else { return }
        do {
            let client = try APIClient(
                baseURL: URL(string: "https://api.lacollecteur.com/")!,
                keychain: KeychainStore(service: "com.lacollecteur.persons")
            )
            api = client
            signedIn = await client.isSignedIn
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
