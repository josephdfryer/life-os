import Foundation

public enum DevicePlatform: String, Codable, Sendable { case macos, ios }
public enum ConnectorSource: String, Codable, CaseIterable, Sendable {
    case imessage, whatsapp, callHistory = "call_history", healthkit, location, photos, voiceJournal = "voice_journal", documents
}
public enum PermissionStatus: String, Codable, Sendable { case unknown, notRequested = "not_requested", granted, limited, denied, revoked, unsupported }
public enum ConnectorHealth: String, Codable, Sendable { case unknown, healthy, paused, degraded, error, unsupported }

public struct ConnectorStatus: Codable, Identifiable, Sendable {
    public var id: String { source.rawValue }
    public let source: ConnectorSource
    public var enabled: Bool
    public var permissionStatus: PermissionStatus
    public var healthStatus: ConnectorHealth
    public var lastSuccessAt: Date?
    public var lastErrorCode: String?
    public let schemaVersion: Int

    public init(source: ConnectorSource, enabled: Bool = false, permissionStatus: PermissionStatus = .unknown, healthStatus: ConnectorHealth = .unknown, lastSuccessAt: Date? = nil, lastErrorCode: String? = nil, schemaVersion: Int = 1) {
        self.source = source; self.enabled = enabled; self.permissionStatus = permissionStatus; self.healthStatus = healthStatus
        self.lastSuccessAt = lastSuccessAt; self.lastErrorCode = lastErrorCode; self.schemaVersion = schemaVersion
    }
}

public struct NormalizedRecord: Codable, Sendable {
    public let type: String
    public let fields: [String: JSONValue]
    public init(type: String, fields: [String: JSONValue]) { self.type = type; self.fields = fields }

    private enum CodingKeys: String, CodingKey { case type }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        type = try container.decode(String.self, forKey: DynamicCodingKey("type"))
        var values: [String: JSONValue] = [:]
        for key in container.allKeys where key.stringValue != "type" { values[key.stringValue] = try container.decode(JSONValue.self, forKey: key) }
        fields = values
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)
        try container.encode(type, forKey: DynamicCodingKey("type"))
        for (key, value) in fields { try container.encode(value, forKey: DynamicCodingKey(key)) }
    }
}

public enum JSONValue: Codable, Sendable, Equatable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let decoded = try? value.decode(Bool.self) { self = .bool(decoded) }
        else if let decoded = try? value.decode(Double.self) { self = .number(decoded) }
        else if let decoded = try? value.decode(String.self) { self = .string(decoded) }
        else if let decoded = try? value.decode([String: JSONValue].self) { self = .object(decoded) }
        else { self = .array(try value.decode([JSONValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self { case .string(let v): try value.encode(v); case .number(let v): try value.encode(v); case .bool(let v): try value.encode(v); case .object(let v): try value.encode(v); case .array(let v): try value.encode(v); case .null: try value.encodeNil() }
    }
}

private struct DynamicCodingKey: CodingKey {
    let stringValue: String; let intValue: Int? = nil
    init(_ value: String) { stringValue = value }
    init?(stringValue: String) { self.init(stringValue) }
    init?(intValue: Int) { return nil }
}

public struct OutboxItem: Codable, Identifiable, Sendable {
    public let id: UUID
    public let deviceId: String
    public let source: ConnectorSource
    public let sourceId: String
    public let schemaVersion: Int
    public let observedAt: Date
    public let record: NormalizedRecord
    public let createdAt: Date
    public var attempts: Int
    public var nextAttemptAt: Date
    public init(id: UUID = UUID(), deviceId: String, source: ConnectorSource, sourceId: String, observedAt: Date, record: NormalizedRecord) {
        self.id = id; self.deviceId = deviceId; self.source = source; self.sourceId = sourceId; self.schemaVersion = 1
        self.observedAt = observedAt; self.record = record; self.createdAt = Date(); self.attempts = 0; self.nextAttemptAt = Date()
    }
}

public struct TokenPair: Codable, Sendable {
    public let tokenType, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, deviceId, workspaceId: String
    public let scopes: [String]
}

public struct DeviceIngestResult: Codable, Sendable { public let sourceId, status: String; public let resultType, resultId, errorCode: String? }
public struct DeviceIngestResponse: Codable, Sendable { public let batchId: String; public let results: [DeviceIngestResult] }
