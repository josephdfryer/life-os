import AuthenticationServices
import CryptoKit
import Foundation
import LifeOSCompanionCore

// GoogleContactsConnector authenticates via Google OAuth 2.0 + PKCE using
// ASWebAuthenticationSession, then pages through the People API to import
// the user's Google contacts as contact.person records.
//
// Setup required (one-time):
//   1. Google Cloud Console → Enable "People API"
//   2. Create an OAuth 2.0 client ID → Application type: iOS
//      Bundle ID: com.lacollecteur.persons.ios
//   3. Set GoogleOAuthClientId in Persons-iOS-Info.plist (or pass at init)
//
// The redirect URI for iOS native apps uses the reverse-DNS client ID scheme:
//   com.googleusercontent.apps.<client-id-prefix>:/oauth2callback
// Add that scheme to CFBundleURLSchemes in the plist.

@MainActor
final class GoogleContactsConnector: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var status: ConnectorStatus
    @Published var importedCount = 0
    @Published var isImporting = false
    @Published var errorMessage: String?

    weak var model: PersonsAppModel?
    private var authSession: ASWebAuthenticationSession?

    // Filled from Info.plist key "GoogleOAuthClientId"
    private let clientId: String?

    private static let scope = "https://www.googleapis.com/auth/contacts.readonly"
    private static let tokenKey = "google.contacts.access_token"
    private static let refreshKey = "google.contacts.refresh_token"
    private let keychain = KeychainStore(service: "com.lacollecteur.persons")

    init(model: PersonsAppModel? = nil) {
        self.model = model
        self.status = ConnectorStatus(source: .googleContacts)
        self.clientId = Bundle.main.object(forInfoDictionaryKey: "GoogleOAuthClientId") as? String
        super.init()
    }

    var isConfigured: Bool { clientId != nil && !clientId!.isEmpty }

    func authorize() async {
        guard let clientId else {
            errorMessage = "Google OAuth client ID not configured. Add GoogleOAuthClientId to Info.plist."
            return
        }
        let verifier = randomToken(64)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        let redirectScheme = "com.googleusercontent.apps.\(clientId.components(separatedBy: ".").last ?? clientId)"
        let redirectUri = "\(redirectScheme):/oauth2callback"

        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectUri),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: Self.scope),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "consent"),
        ]

        let session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: redirectScheme) { [weak self] callback, error in
            Task { @MainActor in
                guard error == nil,
                      let self,
                      let callback,
                      let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                          .queryItems?.first(where: { $0.name == "code" })?.value else {
                    self?.errorMessage = "Google sign-in was cancelled."
                    return
                }
                await self.exchange(code: code, verifier: verifier, redirectUri: redirectUri, clientId: clientId)
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false // allow Google account chooser
        authSession = session
        session.start()
    }

    private func exchange(code: String, verifier: String, redirectUri: String, clientId: String) async {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let body = [
            "code": code,
            "client_id": clientId,
            "redirect_uri": redirectUri,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        ].map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
            .joined(separator: "&")
        request.httpBody = body.data(using: .utf8)

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            let json = try JSONDecoder().decode(TokenResponse.self, from: data)
            try keychain.set(Data(json.access_token.utf8), account: Self.tokenKey)
            if let refresh = json.refresh_token {
                try keychain.set(Data(refresh.utf8), account: Self.refreshKey)
            }
            status.enabled = true
            status.permissionStatus = .granted
            status.healthStatus = .healthy
            UserDefaults.standard.set(true, forKey: "persons.googleContacts.enabled")
            await importContacts()
        } catch {
            errorMessage = "Failed to exchange Google auth code: \(error.localizedDescription)"
        }
    }

    func importContacts() async {
        guard let tokenData = try? keychain.data(account: Self.tokenKey),
              let accessToken = String(data: tokenData, encoding: .utf8) else {
            errorMessage = "Not connected to Google. Tap Connect to sign in."
            return
        }
        isImporting = true
        defer { isImporting = false }

        var pageToken: String? = nil
        var total = 0

        repeat {
            var components = URLComponents(string: "https://people.googleapis.com/v1/people/me/connections")!
            var items: [URLQueryItem] = [
                URLQueryItem(name: "personFields", value: "names,emailAddresses,phoneNumbers,organizations,birthdays"),
                URLQueryItem(name: "pageSize", value: "1000"),
            ]
            if let token = pageToken {
                items.append(URLQueryItem(name: "pageToken", value: token))
            }
            components.queryItems = items

            var request = URLRequest(url: components.url!)
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                if let http = response as? HTTPURLResponse, http.statusCode == 401 {
                    // Token expired — try refresh
                    if await refreshToken() {
                        // Retry once after refresh
                        await importContacts()
                        return
                    }
                    errorMessage = "Google session expired. Tap Connect to sign in again."
                    status.enabled = false
                    UserDefaults.standard.removeObject(forKey: "persons.googleContacts.enabled")
                    return
                }
                let page = try JSONDecoder().decode(ConnectionsResponse.self, from: data)
                for person in page.connections ?? [] {
                    await enqueue(person)
                    total += 1
                }
                pageToken = page.nextPageToken
            } catch {
                errorMessage = "Import error: \(error.localizedDescription)"
                return
            }
        } while pageToken != nil

        importedCount = total
        status.healthStatus = .healthy
    }

    private func refreshToken() async -> Bool {
        guard let clientId,
              let refreshData = try? keychain.data(account: Self.refreshKey),
              let refresh = String(data: refreshData, encoding: .utf8) else { return false }
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let body = "grant_type=refresh_token&client_id=\(clientId)&refresh_token=\(refresh)"
        request.httpBody = body.data(using: .utf8)
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let json = try? JSONDecoder().decode(TokenResponse.self, from: data) else { return false }
        try? keychain.set(Data(json.access_token.utf8), account: Self.tokenKey)
        return true
    }

    private func enqueue(_ person: GooglePerson) async {
        guard let deviceId = await model?.api?.deviceId else { return }
        let name = person.names?.first
        let given = name?.givenName ?? ""
        let family = name?.familyName ?? ""
        guard !given.isEmpty || !family.isEmpty else { return }

        let emails = person.emailAddresses?.compactMap { $0.value } ?? []
        let phones = person.phoneNumbers?.compactMap { $0.value } ?? []
        let org = person.organizations?.first?.name ?? ""
        let title = person.organizations?.first?.title ?? ""

        var birthdayStr: String? = nil
        if let bday = person.birthdays?.first?.date {
            if let y = bday.year, let m = bday.month, let d = bday.day {
                birthdayStr = String(format: "%04d-%02d-%02d", y, m, d)
            } else if let m = bday.month, let d = bday.day {
                birthdayStr = String(format: "--%02d-%02d", m, d)
            }
        }

        var fields: [String: JSONValue] = [
            "givenName": given.isEmpty ? .null : .string(given),
            "familyName": family.isEmpty ? .null : .string(family),
            "emails": .array(emails.map { .string($0) }),
            "phones": .array(phones.map { .string($0) }),
            "organizationName": org.isEmpty ? .null : .string(org),
            "jobTitle": title.isEmpty ? .null : .string(title),
        ]
        if let b = birthdayStr { fields["birthday"] = .string(b) }

        // sourceId is the People API resource name (stable per Google account)
        let sourceId = person.resourceName ?? UUID().uuidString
        let record = NormalizedRecord(type: "contact.person", fields: fields)
        await model?.enqueue(OutboxItem(
            deviceId: deviceId,
            source: .googleContacts,
            sourceId: sourceId,
            observedAt: Date(),
            record: record
        ))
    }

    func disconnect() {
        try? keychain.delete(account: Self.tokenKey)
        try? keychain.delete(account: Self.refreshKey)
        UserDefaults.standard.removeObject(forKey: "persons.googleContacts.enabled")
        status = ConnectorStatus(source: .googleContacts)
        importedCount = 0
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first ?? ASPresentationAnchor()
    }

    private func randomToken(_ count: Int) -> String {
        Data((0..<count).map { _ in UInt8.random(in: .min ... .max) }).base64URL
    }

    // MARK: - Decodable models

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String?
    }

    private struct ConnectionsResponse: Decodable {
        let connections: [GooglePerson]?
        let nextPageToken: String?
    }

    private struct GooglePerson: Decodable {
        let resourceName: String?
        let names: [Name]?
        let emailAddresses: [EmailAddress]?
        let phoneNumbers: [PhoneNumber]?
        let organizations: [Organization]?
        let birthdays: [Birthday]?

        struct Name: Decodable { let givenName: String?; let familyName: String? }
        struct EmailAddress: Decodable { let value: String? }
        struct PhoneNumber: Decodable { let value: String? }
        struct Organization: Decodable { let name: String?; let title: String? }
        struct Birthday: Decodable { let date: BirthdayDate? }
        struct BirthdayDate: Decodable { let year: Int?; let month: Int?; let day: Int? }
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
