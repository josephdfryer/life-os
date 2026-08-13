import Foundation
import os

public protocol CompanionConnector: Actor {
    var source: ConnectorSource { get }
    func permissionStatus() async -> PermissionStatus
    func collect() async throws -> [OutboxItem]
    func repair() async throws
}

public struct RedactedLogger: Sendable {
    private let logger: Logger
    public init(category: String) { logger = Logger(subsystem: "com.lacollecteur.lifeos.companion", category: category) }
    public func info(_ message: String) { logger.info("\(message, privacy: .public)") }
    public func error(code: String) { logger.error("connector_error code=\(code, privacy: .public)") }
}

public enum CompanionPaths {
    public static func applicationSupport() throws -> URL {
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return root.appending(path: "Life OS Companion", directoryHint: .isDirectory)
    }
}
