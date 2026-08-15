import Foundation

public actor APIClient {
    public let baseURL: URL
    private let keychain: KeychainStore
    private var tokens: TokenPair?
    public init(baseURL: URL, keychain: KeychainStore = KeychainStore()) throws { self.baseURL = baseURL; self.keychain = keychain; if let data = try keychain.data(account: "device-credential") { tokens = try JSONDecoder.lifeOS.decode(TokenPair.self, from: data) } }
    public var deviceId: String? { tokens?.deviceId }
    public var isSignedIn: Bool { tokens != nil }

    public func save(_ pair: TokenPair) throws { tokens = pair; try keychain.set(JSONEncoder.lifeOS.encode(pair), account: "device-credential") }
    public func signOut() throws { tokens = nil; try keychain.delete(account: "device-credential") }
    public func exchange(code: String, verifier: String, deviceId: String) async throws { let body = ["code": code, "codeVerifier": verifier, "deviceId": deviceId]; let pair: TokenPair = try await send(path: "v1/device/auth/exchange", body: body, authorized: false); try save(pair) }
    public func heartbeat(appVersion: String, sources: [ConnectorStatus]) async throws { struct Body: Encodable { let appVersion: String; let sources: [ConnectorStatus] }; let _: HeartbeatResponse = try await send(path: "v1/device/heartbeat", body: Body(appVersion: appVersion, sources: sources), authorized: true) }
    public func ingest(_ items: [OutboxItem]) async throws -> DeviceIngestResponse {
        struct WireItem: Encodable { let deviceId: String; let source: ConnectorSource; let sourceId: String; let schemaVersion: Int; let observedAt: Date; let record: NormalizedRecord }
        struct Batch: Encodable { let batchId = UUID().uuidString; let schemaVersion = 1; let items: [WireItem] }
        let wire = items.map { WireItem(deviceId: $0.deviceId, source: $0.source, sourceId: $0.sourceId, schemaVersion: $0.schemaVersion, observedAt: $0.observedAt, record: $0.record) }
        return try await send(path: "v1/device/ingest", body: Batch(items: wire), authorized: true)
    }

    public func get<Response: Decodable>(path: String, queryItems: [URLQueryItem] = []) async throws -> Response {
        try await get(path: path, queryItems: queryItems, mayRefresh: true)
    }

    private func get<Response: Decodable>(path: String, queryItems: [URLQueryItem], mayRefresh: Bool) async throws -> Response {
        guard let access = tokens?.accessToken else { throw APIError.signedOut }
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components?.url else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401, mayRefresh {
            try await refresh()
            return try await get(path: path, queryItems: queryItems, mayRefresh: false)
        }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
        return try JSONDecoder.lifeOS.decode(Response.self, from: data)
    }

    private func send<Response: Decodable, Body: Encodable>(path: String, body: Body, authorized: Bool, mayRefresh: Bool = true) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path)); request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONEncoder.lifeOS.encode(body)
        if authorized { guard let access = tokens?.accessToken else { throw APIError.signedOut }; request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await URLSession.shared.data(for: request); guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401, authorized, mayRefresh { try await refresh(); return try await send(path: path, body: body, authorized: true, mayRefresh: false) }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
        return try JSONDecoder.lifeOS.decode(Response.self, from: data)
    }
    private func refresh() async throws { guard let refreshToken = tokens?.refreshToken else { throw APIError.signedOut }; let pair: TokenPair = try await send(path: "v1/device/auth/refresh", body: ["refreshToken": refreshToken], authorized: false, mayRefresh: false); try save(pair) }
}
private struct HeartbeatResponse: Decodable { let receivedAt: String }
public enum APIError: Error { case signedOut, invalidResponse, http(Int) }

public actor UploadScheduler {
    private let outbox: EncryptedOutbox; private let api: APIClient
    public init(outbox: EncryptedOutbox, api: APIClient) { self.outbox = outbox; self.api = api }
    @discardableResult public func runOnce() async throws -> Int {
        let due = try await outbox.due(); guard !due.isEmpty else { return 0 }
        let response = try await api.ingest(due); var completed: [UUID] = []
        for (item, result) in zip(due, response.results) { if result.status == "accepted" || result.status == "duplicate" || result.status == "rejected" { completed.append(item.id) } else { try await outbox.retry(id: item.id, attempts: item.attempts + 1) } }
        try await outbox.remove(ids: completed); return completed.count
    }
}
