import Foundation
import LifeOSCompanionCore

public protocol PersonsDataSource: Sendable {
    func people(query: String, cursor: String?) async throws -> PeoplePage
}

public struct PersonsClient: PersonsDataSource, Sendable {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func people(query: String, cursor: String?) async throws -> PeoplePage {
        var items = [URLQueryItem(name: "limit", value: "100")]
        if !query.isEmpty { items.append(URLQueryItem(name: "q", value: query)) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await api.get(path: "v1/people", queryItems: items)
    }
}
