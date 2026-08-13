import CryptoKit
import Foundation
import SQLite3

public actor EncryptedOutbox {
    private let db: OpaquePointer
    private let key: SymmetricKey
    private let encoder = JSONEncoder.lifeOS
    private let decoder = JSONDecoder.lifeOS

    public init(databaseURL: URL, keychain: KeychainStore = KeychainStore()) throws {
        try FileManager.default.createDirectory(at: databaseURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        var connection: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &connection, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let connection else { throw OutboxError.open }
        db = connection
        if let existing = try keychain.data(account: "outbox-encryption-key") { key = SymmetricKey(data: existing) }
        else { let data = Data((0..<32).map { _ in UInt8.random(in: .min ... .max) }); try keychain.set(data, account: "outbox-encryption-key"); key = SymmetricKey(data: data) }
        try Self.execute(db, "PRAGMA journal_mode=WAL")
        try Self.execute(db, "PRAGMA secure_delete=ON")
        try Self.execute(db, "CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL, created_at REAL NOT NULL, next_attempt_at REAL NOT NULL, attempts INTEGER NOT NULL, payload BLOB NOT NULL, UNIQUE(source, source_id))")
        try Self.execute(db, "CREATE INDEX IF NOT EXISTS outbox_due ON outbox(next_attempt_at, created_at)")
        try Self.execute(db, "CREATE TABLE IF NOT EXISTS checkpoints (source TEXT PRIMARY KEY, payload BLOB NOT NULL, updated_at REAL NOT NULL)")
    }

    deinit { sqlite3_close(db) }

    public func enqueue(_ item: OutboxItem) throws {
        let encrypted = try seal(encoder.encode(item))
        let sql = "INSERT OR IGNORE INTO outbox (id,source,source_id,created_at,next_attempt_at,attempts,payload) VALUES (?,?,?,?,?,?,?)"
        var statement: OpaquePointer?; guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw OutboxError.statement }
        defer { sqlite3_finalize(statement) }
        bind(item.id.uuidString, 1, statement); bind(item.source.rawValue, 2, statement); bind(item.sourceId, 3, statement)
        sqlite3_bind_double(statement, 4, item.createdAt.timeIntervalSince1970); sqlite3_bind_double(statement, 5, item.nextAttemptAt.timeIntervalSince1970); sqlite3_bind_int(statement, 6, Int32(item.attempts)); _ = encrypted.withUnsafeBytes { sqlite3_bind_blob(statement, 7, $0.baseAddress, Int32(encrypted.count), SQLITE_TRANSIENT) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw OutboxError.statement }
    }

    public func due(limit: Int = 100, now: Date = Date()) throws -> [OutboxItem] {
        let sql = "SELECT payload FROM outbox WHERE next_attempt_at <= ? ORDER BY source, created_at LIMIT ?"
        var statement: OpaquePointer?; guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw OutboxError.statement }
        defer { sqlite3_finalize(statement) }; sqlite3_bind_double(statement, 1, now.timeIntervalSince1970); sqlite3_bind_int(statement, 2, Int32(min(max(limit, 1), 200)))
        var values: [OutboxItem] = []
        while sqlite3_step(statement) == SQLITE_ROW { let count = Int(sqlite3_column_bytes(statement, 0)); guard let bytes = sqlite3_column_blob(statement, 0) else { continue }; values.append(try decoder.decode(OutboxItem.self, from: try open(Data(bytes: bytes, count: count)))) }
        return values
    }

    public func remove(ids: [UUID]) throws { for id in ids { try Self.execute(db, "DELETE FROM outbox WHERE id = ?", bindings: [id.uuidString]) } }
    public func retry(id: UUID, attempts: Int, now: Date = Date()) throws { let delay = min(pow(2, Double(attempts)) * 30, 21_600); try Self.execute(db, "UPDATE outbox SET attempts = ?, next_attempt_at = ? WHERE id = ?", bindings: [attempts, now.addingTimeInterval(delay).timeIntervalSince1970, id.uuidString]) }
    public func pendingCount() throws -> Int { Int(try Self.scalarInt(db, "SELECT COUNT(*) FROM outbox")) }

    public func setCheckpoint<T: Codable>(_ value: T, source: ConnectorSource) throws {
        let payload = try seal(encoder.encode(value))
        try Self.execute(db, "INSERT INTO checkpoints(source,payload,updated_at) VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at", bindings: [source.rawValue, payload, Date().timeIntervalSince1970])
    }
    public func checkpoint<T: Codable>(_ type: T.Type, source: ConnectorSource) throws -> T? {
        var statement: OpaquePointer?; guard sqlite3_prepare_v2(db, "SELECT payload FROM checkpoints WHERE source = ?", -1, &statement, nil) == SQLITE_OK else { throw OutboxError.statement }; defer { sqlite3_finalize(statement) }; bind(source.rawValue, 1, statement)
        guard sqlite3_step(statement) == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { return nil }; let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))); return try decoder.decode(T.self, from: try open(data))
    }

    private func seal(_ data: Data) throws -> Data { guard let combined = try AES.GCM.seal(data, using: key).combined else { throw OutboxError.crypto }; return combined }
    private func open(_ data: Data) throws -> Data { try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key) }
    private func bind(_ value: String, _ index: Int32, _ statement: OpaquePointer?) { sqlite3_bind_text(statement, index, value, -1, SQLITE_TRANSIENT) }

    private static func execute(_ db: OpaquePointer, _ sql: String, bindings: [Any] = []) throws {
        var statement: OpaquePointer?; guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw OutboxError.statement }; defer { sqlite3_finalize(statement) }
        for (offset, value) in bindings.enumerated() { let index = Int32(offset + 1); if let value = value as? String { sqlite3_bind_text(statement, index, value, -1, SQLITE_TRANSIENT) } else if let value = value as? Double { sqlite3_bind_double(statement, index, value) } else if let value = value as? Int { sqlite3_bind_int64(statement, index, sqlite3_int64(value)) } else if let value = value as? Data { _ = value.withUnsafeBytes { sqlite3_bind_blob(statement, index, $0.baseAddress, Int32(value.count), SQLITE_TRANSIENT) } } }
        var result = sqlite3_step(statement)
        while result == SQLITE_ROW { result = sqlite3_step(statement) }
        guard result == SQLITE_DONE else { throw OutboxError.statement }
    }
    private static func scalarInt(_ db: OpaquePointer, _ sql: String) throws -> Int64 { var statement: OpaquePointer?; guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw OutboxError.statement }; defer { sqlite3_finalize(statement) }; guard sqlite3_step(statement) == SQLITE_ROW else { throw OutboxError.statement }; return sqlite3_column_int64(statement, 0) }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
public enum OutboxError: Error { case open, statement, crypto }

extension JSONEncoder { static var lifeOS: JSONEncoder { let value = JSONEncoder(); value.dateEncodingStrategy = .iso8601; return value } }
extension JSONDecoder { static var lifeOS: JSONDecoder { let value = JSONDecoder(); value.dateDecodingStrategy = .iso8601; return value } }
