import Foundation

public struct Person: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let createdAt: Date
    public let updatedAt: Date
    public let first: String
    public let last: String
    public let nickname: String?
    public let title: String?
    public let headline: String?
    public let company: String?
    public let emails: [String]
    public let phones: [String]
    public let birthday: String?
    public let closeness: Int
    public let tags: [String]
    public let values: [String]
    public let notes: String?
    public let location: String?
    public let linkedin: String?
    public let twitter: String?
    public let website: String?
    public let facebook: String?
    public let instagram: String?
    public let color: String?
    public let colorSoft: String?

    public var displayName: String {
        let name = [first, last].filter { !$0.isEmpty }.joined(separator: " ")
        return name.isEmpty ? "Unnamed person" : name
    }

    public var initials: String {
        [first, last].compactMap(\.first).prefix(2).map(String.init).joined().uppercased()
    }

    public var contextLine: String? {
        if let headline, !headline.isEmpty { return headline }
        if let company, !company.isEmpty { return company }
        if let location, !location.isEmpty { return location }
        return emails.first ?? phones.first
    }
}

public struct PeoplePage: Codable, Sendable {
    public let data: [Person]
    public let nextCursor: String?
    public let hasMore: Bool
    public let limit: Int
}
