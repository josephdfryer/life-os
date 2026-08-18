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
        var birthday: String?   // "MM/DD"
        var profileUrl: String?
        var hometown: String?
        var location: String?
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
            if let bday = contact.birthday { fields["birthday"] = .string(bday) }
            if let url = contact.profileUrl { fields["profileUrl"] = .string(url) }
            if let hometown = contact.hometown { fields["hometown"] = .string(hometown) }
            if let loc = contact.location { fields["location"] = .string(loc) }
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
    // Extracts user objects from all inline Relay/GraphQL JSON blobs on the page.
    // Captures: id, name, profile URL (vanity or id-based), hometown, current city.
    static let extractUsersJS = """
    (function() {
        var byId = {};
        var scripts = Array.from(document.querySelectorAll('script'));
        for (var s of scripts) {
            var text = s.textContent;
            if (!text.includes('"__typename":"User"') && !text.includes('"id":')) continue;
            // Attempt structured JSON parse of any __bbox require payloads
            var bboxMatches = text.matchAll(/\\{[^{}]{0,4096}"__typename":"User"[^{}]{0,4096}\\}/g);
            for (var bm of bboxMatches) {
                try {
                    var obj = JSON.parse(bm[0]);
                    if (!obj.id || !obj.name) continue;
                    var entry = byId[obj.id] || { profileId: obj.id, name: obj.name };
                    if (obj.url) entry.profileUrl = obj.url.replace(/\\\\/g, '');
                    if (obj.hometown && obj.hometown.name) entry.hometown = obj.hometown.name;
                    if (obj.current_city && obj.current_city.name) entry.location = obj.current_city.name;
                    if (obj.birthdate) {
                        if (obj.birthdate.day && obj.birthdate.month) {
                            entry.month = obj.birthdate.month;
                            entry.day = obj.birthdate.day;
                        }
                    }
                    byId[obj.id] = entry;
                } catch(e) {}
            }
            // Regex fallback for fragmented JSON
            var idNames = text.matchAll(/"id":"(\\d{6,})","name":"([^"]{2,80})"/g);
            for (var m of idNames) {
                if (!byId[m[1]]) byId[m[1]] = { profileId: m[1], name: m[2] };
            }
            var bdayMatches = text.matchAll(/"id":"(\\d{6,})"[^}]{0,200}"birthdate":\\{"day":(\\d+),"month":(\\d+)/g);
            for (var bm2 of bdayMatches) {
                if (byId[bm2[1]]) { byId[bm2[1]].day = parseInt(bm2[2]); byId[bm2[1]].month = parseInt(bm2[3]); }
            }
            var urlMatches = text.matchAll(/"id":"(\\d{6,})"[^}]{0,200}"url":"(https:\\\\/\\\\/www\\.facebook\\.com\\\\/[^"]+)"/g);
            for (var um of urlMatches) {
                if (byId[um[1]]) byId[um[1]].profileUrl = um[2].replace(/\\\\/g, '');
            }
        }
        // DOM fallback for friends list visible links
        var links = Array.from(document.querySelectorAll('a[href*="facebook.com"], a[href^="/"]'));
        for (var a of links) {
            var href = (a.getAttribute('href') || '').replace(/\\\\/g, '');
            var idM = href.match(/[?&]id=(\\d{6,})/);
            var fullUrl = href.startsWith('http') ? href : 'https://www.facebook.com' + href;
            var vanityM = href.match(/\\/([a-zA-Z0-9.]{5,50})(?:\\?|$)/);
            if (idM) {
                var uid = idM[1];
                if (!byId[uid]) {
                    var name = (a.textContent || '').trim();
                    if (name && name.length >= 2 && name.length <= 60) byId[uid] = { profileId: uid, name: name };
                }
                if (byId[uid] && !byId[uid].profileUrl) byId[uid].profileUrl = fullUrl.split('?')[0];
            } else if (vanityM && !['home','friends','events','groups','watch','marketplace','me','messages'].includes(vanityM[1])) {
                var name2 = (a.textContent || '').trim();
                if (name2 && name2.length >= 2 && name2.length <= 60) {
                    var key = 'vanity:' + vanityM[1];
                    if (!byId[key]) byId[key] = { profileId: key, name: name2, profileUrl: 'https://www.facebook.com/' + vanityM[1] };
                }
            }
        }
        var results = Object.values(byId).filter(function(r) { return r.name && r.name.length >= 2; });
        return JSON.stringify(results.slice(0, 5000));
    })();
    """

    // Keep old names pointing at unified extractor for the coordinator
    static var birthdayExtractionJS: String { extractUsersJS }
    static var friendsListJS: String { extractUsersJS }
}
