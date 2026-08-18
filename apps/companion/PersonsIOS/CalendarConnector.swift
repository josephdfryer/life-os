import EventKit
import Foundation
import LifeOSCompanionCore

@MainActor
final class CalendarConnector {
    private weak var model: PersonsAppModel?
    private let store = EKEventStore()

    init(model: PersonsAppModel) {
        self.model = model
    }

    func requestAccess() async throws {
        if #available(iOS 17, *) {
            try await store.requestFullAccessToEvents()
        } else {
            let granted = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Bool, Error>) in
                store.requestAccess(to: .event) { granted, error in
                    if let error { cont.resume(throwing: error) }
                    else { cont.resume(returning: granted) }
                }
            }
            guard granted else { throw CalendarError.denied }
        }
    }

    var authorizationStatus: EKAuthorizationStatus {
        EKEventStore.authorizationStatus(for: .event)
    }

    // Scans the past 90 days + next 30 days of calendar events,
    // extracts attendees with a real email, and enqueues them.
    func sync() async {
        guard let deviceId = await model?.api?.deviceId else { return }
        let now = Date()
        let start = Calendar.current.date(byAdding: .day, value: -90, to: now) ?? now
        let end = Calendar.current.date(byAdding: .day, value: 30, to: now) ?? now
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)

        let events = await Task.detached(priority: .utility) { [store, predicate] in
            store.events(matching: predicate)
        }.value

        var seen = Set<String>()
        for event in events {
            guard let attendees = event.attendees else { continue }
            for attendee in attendees {
                guard attendee.participantType == .person,
                      attendee.participantRole != .nonParticipant,
                      let email = attendee.url.absoluteString.lowercased()
                          .components(separatedBy: "mailto:").last,
                      email.contains("@"),
                      !email.hasSuffix("@resource.calendar.google.com"),
                      !seen.contains(email) else { continue }
                seen.insert(email)
                await enqueue(attendee, email: email, eventTitle: event.title, deviceId: deviceId)
            }
        }
    }

    func attendeeCount() async -> Int {
        let now = Date()
        let start = Calendar.current.date(byAdding: .day, value: -90, to: now) ?? now
        let end = Calendar.current.date(byAdding: .day, value: 30, to: now) ?? now
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = await Task.detached(priority: .utility) { [store, predicate] in
            store.events(matching: predicate)
        }.value
        var seen = Set<String>()
        for event in events {
            for attendee in (event.attendees ?? []) {
                if let email = attendee.url.absoluteString.components(separatedBy: "mailto:").last,
                   email.contains("@"), !email.hasSuffix("@resource.calendar.google.com") {
                    seen.insert(email.lowercased())
                }
            }
        }
        return seen.count
    }

    private func enqueue(_ attendee: EKParticipant, email: String, eventTitle: String?, deviceId: String) async {
        let name = attendee.name ?? ""
        let parts = name.split(separator: " ", maxSplits: 1)
        let given = parts.first.map(String.init) ?? ""
        let family = parts.count > 1 ? String(parts[1]) : ""
        let fields: [String: JSONValue] = [
            "givenName": given.isEmpty ? .null : .string(given),
            "familyName": family.isEmpty ? .null : .string(family),
            "emails": .array([.string(email)]),
            "phones": .array([]),
            "organizationName": .null,
            "jobTitle": .null,
        ]
        let record = NormalizedRecord(type: "contact.person", fields: fields)
        // sourceId is the email so duplicate attendees across events deduplicate server-side
        await model?.enqueue(OutboxItem(
            deviceId: deviceId,
            source: .calendar,
            sourceId: email,
            observedAt: Date(),
            record: record
        ))
    }
}

enum CalendarError: Error { case denied }
