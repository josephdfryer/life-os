import Foundation
import SQLite3
import LifeOSCompanionCore

actor MacCollector {
    private let outbox: EncryptedOutbox
    private let api: APIClient
    init(outbox: EncryptedOutbox, api: APIClient) { self.outbox = outbox; self.api = api }

    func collectOnce() async throws {
        guard let deviceId = await api.deviceId else { return }
        try await collectMessages(deviceId: deviceId)
        try await collectWhatsApp(deviceId: deviceId)
    }

    private func collectMessages(deviceId: String) async throws {
        let url = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Messages/chat.db")
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let db = try ReadOnlySQLite(url: url); defer { db.close() }
        let checkpoint: RowCheckpoint? = try await outbox.checkpoint(RowCheckpoint.self, source: .imessage)
        if checkpoint == nil { try await outbox.setCheckpoint(RowCheckpoint(rowID: db.maxRowID(table: "message")), source: .imessage); return }
        let sql = "SELECT message.ROWID,message.guid,message.text,message.date,message.is_from_me,COALESCE(handle.id,handle.uncanonicalized_id,chat.chat_identifier) FROM message LEFT JOIN handle ON handle.ROWID=message.handle_id LEFT JOIN chat_message_join ON chat_message_join.message_id=message.ROWID LEFT JOIN chat ON chat.ROWID=chat_message_join.chat_id WHERE message.ROWID>? ORDER BY message.ROWID ASC LIMIT 500"
        var latest = checkpoint!.rowID
        var items: [OutboxItem] = []
        try db.rows(sql: sql, after: latest) { statement in
            let rowID = sqlite3_column_int64(statement, 0); latest = max(latest, rowID)
            guard let text = sqliteString(statement, 2), !text.isEmpty else { return }
            let handle = sqliteString(statement, 5)
            let record = NormalizedRecord(type: "communication.message", fields: ["channel": .string("imessage"), "direction": .string(sqlite3_column_int(statement, 4) == 1 ? "outgoing" : "incoming"), "contactName": .null, "contactHandle": handle.map(JSONValue.string) ?? .null, "text": .string(text), "durationSeconds": .null])
            items.append(OutboxItem(deviceId: deviceId, source: .imessage, sourceId: String(rowID), observedAt: appleDate(sqlite3_column_int64(statement, 3)), record: record))
        }
        for item in items { try await outbox.enqueue(item) }
        try await outbox.setCheckpoint(RowCheckpoint(rowID: latest), source: .imessage)
    }

    private func collectWhatsApp(deviceId: String) async throws {
        let url = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite")
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let db = try ReadOnlySQLite(url: url); defer { db.close() }
        guard db.hasTables(["ZWAMESSAGE", "ZWACHATSESSION"]), db.hasColumns(table: "ZWAMESSAGE", names: ["Z_PK", "ZSTANZAID", "ZTEXT", "ZMESSAGEDATE", "ZISFROMME", "ZCHATSESSION"]) else { throw CollectorError.unsupportedWhatsAppSchema }
        let checkpoint: RowCheckpoint? = try await outbox.checkpoint(RowCheckpoint.self, source: .whatsapp)
        if checkpoint == nil { try await outbox.setCheckpoint(RowCheckpoint(rowID: db.maxRowID(table: "ZWAMESSAGE", column: "Z_PK")), source: .whatsapp); return }
        let sql = "SELECT m.Z_PK,m.ZSTANZAID,m.ZTEXT,m.ZMESSAGEDATE,m.ZISFROMME,COALESCE(c.ZPARTNERNAME,c.ZCONTACTJID,m.ZFROMJID,m.ZTOJID) FROM ZWAMESSAGE m LEFT JOIN ZWACHATSESSION c ON c.Z_PK=m.ZCHATSESSION WHERE m.Z_PK>? ORDER BY m.Z_PK ASC LIMIT 500"
        var latest = checkpoint!.rowID
        var items: [OutboxItem] = []
        try db.rows(sql: sql, after: latest) { statement in
            let rowID = sqlite3_column_int64(statement, 0); latest = max(latest, rowID)
            guard let text = sqliteString(statement, 2), !text.isEmpty else { return }
            let sourceID = sqliteString(statement, 1) ?? String(rowID), handle = sqliteString(statement, 5)
            let record = NormalizedRecord(type: "communication.message", fields: ["channel": .string("whatsapp"), "direction": .string(sqlite3_column_int(statement, 4) == 1 ? "outgoing" : "incoming"), "contactName": handle.map(JSONValue.string) ?? .null, "contactHandle": handle.map(JSONValue.string) ?? .null, "text": .string(text), "durationSeconds": .null])
            items.append(OutboxItem(deviceId: deviceId, source: .whatsapp, sourceId: sourceID, observedAt: appleDateSeconds(sqlite3_column_double(statement, 3)), record: record))
        }
        for item in items { try await outbox.enqueue(item) }
        try await outbox.setCheckpoint(RowCheckpoint(rowID: latest), source: .whatsapp)
    }
}

private struct RowCheckpoint: Codable { let rowID: Int64 }
private enum CollectorError: Error { case unsupportedWhatsAppSchema, database }
private let appleEpoch = Date(timeIntervalSince1970: 978_307_200)
private func appleDate(_ raw: Int64) -> Date { appleEpoch.addingTimeInterval(Double(raw) / (abs(raw) > 10_000_000_000 ? 1_000_000_000 : 1)) }
private func appleDateSeconds(_ raw: Double) -> Date { appleEpoch.addingTimeInterval(raw) }
private func sqliteString(_ statement: OpaquePointer?, _ column: Int32) -> String? { guard sqlite3_column_type(statement, column) != SQLITE_NULL, let bytes = sqlite3_column_text(statement, column) else { return nil }; return String(cString: bytes) }

private final class ReadOnlySQLite {
    private var connection: OpaquePointer?
    init(url: URL) throws { guard sqlite3_open_v2(url.path, &connection, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { throw CollectorError.database }; sqlite3_exec(connection, "PRAGMA query_only=ON", nil, nil, nil) }
    func close() { sqlite3_close(connection); connection = nil }
    func rows(sql: String, after: Int64, body: (OpaquePointer?) throws -> Void) throws { var statement: OpaquePointer?; guard sqlite3_prepare_v2(connection, sql, -1, &statement, nil) == SQLITE_OK else { throw CollectorError.database }; defer { sqlite3_finalize(statement) }; sqlite3_bind_int64(statement, 1, after); while sqlite3_step(statement) == SQLITE_ROW { try body(statement) } }
    func maxRowID(table: String, column: String = "ROWID") -> Int64 { var statement: OpaquePointer?; guard sqlite3_prepare_v2(connection, "SELECT MAX(\(column)) FROM \(table)", -1, &statement, nil) == SQLITE_OK else { return 0 }; defer { sqlite3_finalize(statement) }; return sqlite3_step(statement) == SQLITE_ROW ? sqlite3_column_int64(statement, 0) : 0 }
    func hasTables(_ names: [String]) -> Bool { names.allSatisfy { table in var statement: OpaquePointer?; defer { sqlite3_finalize(statement) }; guard sqlite3_prepare_v2(connection, "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", -1, &statement, nil) == SQLITE_OK else { return false }; sqlite3_bind_text(statement, 1, table, -1, SQLITE_TRANSIENT); return sqlite3_step(statement) == SQLITE_ROW } }
    func hasColumns(table: String, names: [String]) -> Bool { var statement: OpaquePointer?; guard sqlite3_prepare_v2(connection, "PRAGMA table_info(\(table))", -1, &statement, nil) == SQLITE_OK else { return false }; defer { sqlite3_finalize(statement) }; var found = Set<String>(); while sqlite3_step(statement) == SQLITE_ROW { if let name = sqliteString(statement, 1) { found.insert(name) } }; return Set(names).isSubset(of: found) }
}
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
