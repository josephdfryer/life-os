import Contacts
import Foundation
import LifeOSCompanionCore

@MainActor
final class ContactsConnector {
    private weak var model: PersonsAppModel?
    private let store = CNContactStore()

    private let contactKeys: [CNKeyDescriptor] = [
        CNContactGivenNameKey as CNKeyDescriptor,
        CNContactFamilyNameKey as CNKeyDescriptor,
        CNContactOrganizationNameKey as CNKeyDescriptor,
        CNContactJobTitleKey as CNKeyDescriptor,
        CNContactEmailAddressesKey as CNKeyDescriptor,
        CNContactPhoneNumbersKey as CNKeyDescriptor,
    ]

    init(model: PersonsAppModel) {
        self.model = model
    }

    func authorizeAndStart() async throws {
        let granted = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
            store.requestAccess(for: .contacts) { granted, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: granted) }
            }
        }
        guard granted else { throw ContactsError.denied }
        await sync()
    }

    // Apple's incremental change-history API (CNChangeHistoryFetchRequest /
    // enumeratorForChangeHistoryFetchRequest:error:) is explicitly
    // NS_SWIFT_UNAVAILABLE — it cannot be called from Swift at all, confirmed
    // against a real Xcode 26.6 build, not a documentation guess. So this
    // does a full enumerate on every sync instead of a real delta. That's
    // safe, not just a workaround: each contact's sourceId is its stable
    // CNContact.identifier and the payload is content-hashed at the
    // DeviceIngestItem receipt layer (apps/api/lib/device-ingest.ts), so an
    // unchanged contact re-syncs to an idempotent "duplicate" cheaply — the
    // cost is local CNContactStore enumeration time, not server writes.
    func sync() async {
        guard let deviceId = await model?.api?.deviceId else { return }
        // Enumerate on a background thread in batches of 100, then enqueue
        // each batch on the main actor. Avoids spawning thousands of concurrent
        // Tasks while still yielding to the run loop between batches.
        let batches: [[CNContact]] = (try? await Task.detached(priority: .utility) { [store, contactKeys] in
            var batch: [CNContact] = []
            var all: [[CNContact]] = []
            let request = CNContactFetchRequest(keysToFetch: contactKeys)
            try store.enumerateContacts(with: request) { contact, _ in
                batch.append(contact)
                if batch.count == 100 { all.append(batch); batch = [] }
            }
            if !batch.isEmpty { all.append(batch) }
            return all
        }.value) ?? []
        for batch in batches {
            for contact in batch { await enqueue(contact, deviceId: deviceId) }
        }
    }

    private func enqueue(_ contact: CNContact, deviceId: String) async {
        let fields: [String: JSONValue] = [
            "givenName": contact.givenName.isEmpty ? .null : .string(contact.givenName),
            "familyName": contact.familyName.isEmpty ? .null : .string(contact.familyName),
            "organizationName": contact.organizationName.isEmpty ? .null : .string(contact.organizationName),
            "jobTitle": contact.jobTitle.isEmpty ? .null : .string(contact.jobTitle),
            "emails": .array(contact.emailAddresses.map { .string($0.value as String) }),
            "phones": .array(contact.phoneNumbers.map { .string($0.value.stringValue) }),
        ]
        let record = NormalizedRecord(type: "contact.person", fields: fields)
        await model?.enqueue(OutboxItem(deviceId: deviceId, source: .contacts, sourceId: contact.identifier, observedAt: Date(), record: record))
    }

    private func enumerateAllContacts() async throws -> [CNContact] {
        try await Task.detached(priority: .utility) { [store, contactKeys] in
            var results: [CNContact] = []
            let request = CNContactFetchRequest(keysToFetch: contactKeys)
            try store.enumerateContacts(with: request) { contact, _ in results.append(contact) }
            return results
        }.value
    }

    // Count-only enumeration (identifier key only) so the UI can show "N contacts"
    // without paying for the full field set used by sync.
    func totalContactCount() async -> Int {
        (try? await Task.detached(priority: .utility) { [store] in
            var count = 0
            let request = CNContactFetchRequest(keysToFetch: [CNContactIdentifierKey as CNKeyDescriptor])
            try store.enumerateContacts(with: request) { _, _ in count += 1 }
            return count
        }.value) ?? 0
    }
}

enum ContactsError: Error { case denied }
