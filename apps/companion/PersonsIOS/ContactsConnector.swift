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
        let granted = try await withCheckedThrowingContinuation { continuation in
            store.requestAccess(for: .contacts) { granted, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: granted) }
            }
        }
        guard granted else { throw ContactsError.denied }
        await collectFull()
    }

    /// Initial sync: every contact, once. Establishes the change-history
    /// token so subsequent syncs can go incremental instead of re-scanning
    /// the whole address book.
    func collectFull() async {
        guard let deviceId = await model?.api?.deviceId else { return }
        let contacts = (try? await enumerateAllContacts()) ?? []
        for contact in contacts {
            await enqueue(contact, deviceId: deviceId)
        }
        if let token = try? await currentHistoryToken() {
            try? await model?.outbox?.setCheckpoint(token, source: .contacts)
        }
    }

    /// Ongoing sync: only contacts added or changed since the last saved
    /// token. Deletions are intentionally not propagated in v1 — nothing in
    /// this codebase auto-deletes a Person from a passive background sync,
    /// matching the additive-only rule the rest of device ingest follows.
    func collectIncremental() async {
        guard let deviceId = await model?.api?.deviceId else { return }
        guard let savedToken = try? await model?.outbox?.checkpoint(Data.self, source: .contacts) else {
            await collectFull()
            return
        }
        do {
            let (changed, newToken) = try await changedContacts(since: savedToken)
            for contact in changed {
                await enqueue(contact, deviceId: deviceId)
            }
            try? await model?.outbox?.setCheckpoint(newToken, source: .contacts)
        } catch {
            // A stale/invalidated token (e.g. after a full address book
            // restore) surfaces as an error from enumerator(for:) — fall
            // back to a full resync rather than getting stuck.
            await collectFull()
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

    private func currentHistoryToken() async throws -> Data {
        try await Task.detached(priority: .utility) { [store] in
            store.currentHistoryToken
        }.value
    }

    // NOTE: CNChangeHistoryFetchRequest/CNFetchResult is obscure, rarely-used
    // API — written from documentation recollection, not verified against a
    // compiler in this environment. Build this target in Xcode before
    // relying on it; if CNFetchResult's shape differs (e.g. `.value` needs
    // an explicit `as! NSEnumerator`, or the property names differ), this is
    // the block to fix.
    private func changedContacts(since token: Data) async throws -> (contacts: [CNContact], newToken: Data) {
        try await Task.detached(priority: .utility) { [store, contactKeys] in
            let request = CNChangeHistoryFetchRequest()
            request.startingToken = token
            request.shouldUnifyResults = true
            request.additionalContactKeyDescriptors = contactKeys
            let result = try store.enumerator(for: request)
            var contacts: [CNContact] = []
            for case let event as CNChangeHistoryEvent in result.value {
                switch event {
                case let add as CNChangeHistoryAddContactEvent: contacts.append(add.contact)
                case let update as CNChangeHistoryUpdateContactEvent: contacts.append(update.contact)
                default: break // deletes and non-contact events are not propagated in v1
                }
            }
            return (contacts, result.currentHistoryToken)
        }.value
    }
}

enum ContactsError: Error { case denied }
