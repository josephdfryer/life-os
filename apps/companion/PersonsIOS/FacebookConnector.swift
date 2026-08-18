import Foundation
import LifeOSCompanionCore
import WebKit

// FacebookConnector scrapes the authenticated user's Facebook friends and
// birthdays entirely on-device using WKWebView. Facebook credentials never
// leave the device; Persons only receives the extracted contact records.
//
// NOTE: This technique reads data that is visible to the signed-in user in
// their own browser session. It does not use the official Graph API and is
// outside Facebook's Terms of Service for third-party apps. It may break if
// Facebook changes their mobile site structure.

@MainActor
final class FacebookConnector: NSObject, ObservableObject {
    @Published var phase: ImportPhase = .idle
    @Published var importedCount = 0
    @Published var errorMessage: String?

    enum ImportPhase: Equatable {
        case idle
        case loggingIn
        case scanning(page: String)
        case done(count: Int)
        case failed(String)
    }

    // Extracted before handing off to the model
    var extractedContacts: [FacebookContact] = []
    weak var model: PersonsAppModel?

    struct FacebookContact {
        let name: String
        let profileId: String
        var birthday: String? // "MM/DD" or "MM/DD/YYYY"
    }

    // Called by FacebookWebView once the WebView is ready so the connector
    // can inject scripts and navigate without owning the view.
    var onExtractContacts: (([FacebookContact]) -> Void)?

    func reset() {
        phase = .idle
        importedCount = 0
        errorMessage = nil
        extractedContacts = []
    }

    func enqueueAll() async {
        guard let deviceId = await model?.api?.deviceId else { return }
        for contact in extractedContacts {
            let parts = contact.name.split(separator: " ", maxSplits: 1)
            let given = parts.first.map(String.init) ?? contact.name
            let family = parts.count > 1 ? String(parts[1]) : ""
            var fields: [String: JSONValue] = [
                "givenName": given.isEmpty ? .null : .string(given),
                "familyName": family.isEmpty ? .null : .string(family),
                "emails": .array([]),
                "phones": .array([]),
                "organizationName": .null,
                "jobTitle": .null,
            ]
            if let bday = contact.birthday {
                fields["birthday"] = .string(bday)
            }
            let record = NormalizedRecord(type: "contact.person", fields: fields)
            await model?.enqueue(OutboxItem(
                deviceId: deviceId,
                source: .facebook,
                sourceId: contact.profileId,
                observedAt: Date(),
                record: record
            ))
        }
        importedCount = extractedContacts.count
        phase = .done(count: importedCount)
    }

    // JavaScript to extract friends + birthdays from Facebook's mobile site.
    // Called by the WebView delegate after navigating to the birthday page.
    static let birthdayExtractionJS = """
    (function() {
        var results = [];
        // Birthday page: each entry is a link to the profile with the name visible
        // and a nearby date. Facebook's mobile site embeds Relay data in __bbox scripts.
        var scripts = Array.from(document.querySelectorAll('script'));
        for (var s of scripts) {
            var text = s.textContent;
            if (!text.includes('"__typename":"User"') && !text.includes('"name":')) continue;
            // Try to extract from inline Relay JSON
            var matches = text.matchAll(/"id":"(\\d+)","name":"([^"]+)"[^}]*"birthdate":\\{"day":(\\d+),"month":(\\d+)/g);
            for (var m of matches) {
                results.push({ profileId: m[1], name: m[2], month: parseInt(m[4]), day: parseInt(m[3]) });
            }
        }
        // Fallback: parse visible DOM on m.facebook.com/events/birthdays/
        if (results.length === 0) {
            var links = Array.from(document.querySelectorAll('a[href*="/"]'));
            for (var a of links) {
                var href = a.getAttribute('href') || '';
                var idMatch = href.match(/(?:\\/|id=)(\\d{8,})/);
                if (!idMatch) continue;
                var name = (a.textContent || a.innerText || '').trim();
                if (!name || name.length < 2 || name.length > 60) continue;
                // Look for a nearby date string (e.g. "July 18" or "7/18")
                var parent = a.parentElement;
                var dateText = '';
                for (var i = 0; i < 4 && parent; i++) {
                    dateText = parent.innerText || '';
                    if (/\\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\\d{1,2}\\/\\d{1,2})/.test(dateText)) break;
                    parent = parent.parentElement;
                }
                results.push({ profileId: idMatch[1], name: name, dateText: dateText.substring(0, 100) });
            }
        }
        return JSON.stringify(results.slice(0, 2000));
    })();
    """

    static let friendsListJS = """
    (function() {
        var results = [];
        var scripts = Array.from(document.querySelectorAll('script'));
        for (var s of scripts) {
            var text = s.textContent;
            if (!text.includes('"__typename":"User"')) continue;
            var matches = text.matchAll(/"id":"(\\d+)","name":"([^"]+)"/g);
            for (var m of matches) {
                if (parseInt(m[1]) > 1000) {
                    results.push({ profileId: m[1], name: m[2] });
                }
            }
        }
        // Deduplicate by profileId
        var seen = {};
        results = results.filter(function(r) {
            if (seen[r.profileId]) return false;
            seen[r.profileId] = true;
            return true;
        });
        return JSON.stringify(results.slice(0, 5000));
    })();
    """
}
