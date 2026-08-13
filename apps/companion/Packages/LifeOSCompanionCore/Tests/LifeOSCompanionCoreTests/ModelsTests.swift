import XCTest
@testable import LifeOSCompanionCore

final class ModelsTests: XCTestCase {
    func testNormalizedRecordEncodesDiscriminatorAtTopLevel() throws {
        let record = NormalizedRecord(type: "health.daily", fields: ["day": .string("2026-08-11"), "metrics": .array([.object(["key": .string("step_count"), "value": .number(1234)])])])
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as? [String: Any]
        XCTAssertEqual(object?["type"] as? String, "health.daily")
        XCTAssertNotNil(object?["metrics"])
    }

    func testEncryptedOutboxDeduplicatesAndRoundTrips() async throws {
        let service = "com.lacollecteur.lifeos.companion.tests.\(UUID().uuidString)"
        let keychain = KeychainStore(service: service)
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        let databaseURL = directory.appending(path: "outbox.sqlite")
        defer {
            try? keychain.delete(account: "outbox-encryption-key")
            try? FileManager.default.removeItem(at: directory)
        }

        let outbox = try EncryptedOutbox(databaseURL: databaseURL, keychain: keychain)
        let secret = "private transcript that must stay encrypted"
        let item = OutboxItem(
            deviceId: "device-1",
            source: .voiceJournal,
            sourceId: "journal-1",
            observedAt: Date(timeIntervalSince1970: 1_723_334_400),
            record: NormalizedRecord(type: "note.voice_journal", fields: ["transcript": .string(secret)])
        )
        try await outbox.enqueue(item)
        try await outbox.enqueue(OutboxItem(deviceId: "device-1", source: .voiceJournal, sourceId: "journal-1", observedAt: Date(), record: item.record))

        let pendingBeforeRemoval = try await outbox.pendingCount()
        XCTAssertEqual(pendingBeforeRemoval, 1)
        let due = try await outbox.due(now: Date.distantFuture)
        XCTAssertEqual(due.map(\.id), [item.id])
        XCTAssertEqual(due.first?.record.type, item.record.type)
        XCTAssertEqual(due.first?.record.fields, item.record.fields)

        try await outbox.setCheckpoint(["watermark": 42], source: .voiceJournal)
        let checkpoint = try await outbox.checkpoint([String: Int].self, source: .voiceJournal)
        XCTAssertEqual(checkpoint, ["watermark": 42])

        let databaseBytes = try Data(contentsOf: databaseURL)
        XCTAssertNil(databaseBytes.range(of: Data(secret.utf8)))

        try await outbox.remove(ids: [item.id])
        let pendingAfterRemoval = try await outbox.pendingCount()
        XCTAssertEqual(pendingAfterRemoval, 0)
    }
}
