import SwiftUI
import WebKit

struct FacebookWebView: UIViewRepresentable {
    @ObservedObject var connector: FacebookConnector
    let onDone: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(connector: connector, onDone: onDone)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        webView.load(URLRequest(url: URL(string: "https://m.facebook.com/login/")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let connector: FacebookConnector
        let onDone: () -> Void
        weak var webView: WKWebView?
        private var phase: ScanPhase = .awaitingLogin

        enum ScanPhase { case awaitingLogin, goingToBirthdays, scanningBirthdays, goingToFriends, scanningFriends, done }

        init(connector: FacebookConnector, onDone: @escaping () -> Void) {
            self.connector = connector
            self.onDone = onDone
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            let url = webView.url?.absoluteString ?? ""
            connector.debugLog.append("didFinish: \(url.prefix(80))")

            let isOnFB = url.contains("facebook.com")
            let isLogin = url.contains("/login") || url.contains("/checkpoint") || url.contains("/two_step") || url.contains("/recover")

            guard isOnFB, !isLogin else {
                Task { @MainActor in self.connector.phase = .loggingIn }
                return
            }

            switch phase {
            case .awaitingLogin:
                phase = .goingToBirthdays
                Task { @MainActor in self.connector.phase = .scanning(page: "birthdays") }
                webView.load(URLRequest(url: URL(string: "https://m.facebook.com/events/birthdays/")!))

            case .goingToBirthdays:
                if url.contains("birthdays") {
                    phase = .scanningBirthdays
                    // Wait 4s for Facebook's async XHR data to land in the DOM
                    // before extracting. didFinish fires on initial HTML parse,
                    // not after React/Relay finishes populating the page.
                    connector.debugLog.append("Birthday page loaded — waiting 4s for async data…")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self, weak webView] in
                        guard let self, let webView else { return }
                        // Scroll to trigger lazy-loaded content
                        webView.evaluateJavaScript("window.scrollTo(0, document.body.scrollHeight)") { _, _ in }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self, weak webView] in
                            guard let self, let webView else { return }
                            self.runExtraction(webView: webView, label: "birthdays") { [weak self] count in
                                self?.phase = .goingToFriends
                                Task { @MainActor in self?.connector.phase = .scanning(page: "friends") }
                                webView.load(URLRequest(url: URL(string: "https://m.facebook.com/friends/center/friends/")!))
                            }
                        }
                    }
                }

            case .scanningBirthdays:
                break // wait for delayed extraction callback

            case .goingToFriends:
                if url.contains("friends") {
                    phase = .scanningFriends
                    connector.debugLog.append("Friends page loaded — waiting 4s for async data…")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self, weak webView] in
                        guard let self, let webView else { return }
                        webView.evaluateJavaScript("window.scrollTo(0, document.body.scrollHeight)") { _, _ in }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self, weak webView] in
                            guard let self, let webView else { return }
                            self.runExtraction(webView: webView, label: "friends") { [weak self] count in
                                self?.phase = .done
                                Task { @MainActor in
                                    await self?.connector.enqueueAll() // ships log inside
                                    self?.onDone()
                                }
                            }
                        }
                    }
                }

            case .scanningFriends:
                break

            case .done:
                break
            }
        }

        private func runExtraction(webView: WKWebView, label: String, completion: @escaping (Int) -> Void) {
            // Diagnostic: log body length + visible text snippet so we can tell if page loaded
            webView.evaluateJavaScript("(function(){ var b=document.body; return JSON.stringify({url:location.href,bodyLen:(b&&b.innerHTML||'').length,text:(b&&b.innerText||'').substring(0,300)}); })()") { [weak self] r, _ in
                if let s = r as? String, let d = s.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
                    let url = obj["url"] as? String ?? ""
                    let bodyLen = obj["bodyLen"] as? Int ?? 0
                    let text = obj["text"] as? String ?? ""
                    self?.connector.debugLog.append("[\(label)] url=\(url.suffix(60)) bodyLen=\(bodyLen)")
                    self?.connector.debugLog.append("[\(label)] visible: \(text.prefix(200))")
                }
            }
            webView.evaluateJavaScript(extractJS) { [weak self] result, error in
                guard let self else { return }
                if let error { self.connector.debugLog.append("JS error (\(label)): \(error.localizedDescription)") }
                guard let json = result as? String,
                      let data = json.data(using: .utf8),
                      let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                    self.connector.debugLog.append("No data from \(label) (raw: \(String(describing: result).prefix(200)))")
                    completion(0)
                    return
                }
                self.connector.debugLog.append("Extracted \(array.count) entries from \(label)")
                Task { @MainActor in
                    for item in array {
                        guard let id = item["profileId"] as? String,
                              let name = item["name"] as? String,
                              !name.isEmpty else { continue }
                        let birthday = self.birthdayString(from: item)
                        let profileUrl = item["profileUrl"] as? String
                        let hometown = item["hometown"] as? String
                        let location = item["location"] as? String
                        if let idx = self.connector.extractedContacts.firstIndex(where: { $0.profileId == id }) {
                            var c = self.connector.extractedContacts[idx]
                            if c.birthday == nil { c.birthday = birthday }
                            if c.profileUrl == nil { c.profileUrl = profileUrl }
                            if c.hometown == nil { c.hometown = hometown }
                            if c.location == nil { c.location = location }
                            self.connector.extractedContacts[idx] = c
                        } else {
                            self.connector.extractedContacts.append(
                                FacebookConnector.FacebookContact(name: name, profileId: id, birthday: birthday, profileUrl: profileUrl, hometown: hometown, location: location)
                            )
                        }
                    }
                    self.connector.debugLog.append("Total unique contacts: \(self.connector.extractedContacts.count)")
                    completion(array.count)
                }
            }
        }

        private func birthdayString(from item: [String: Any]) -> String? {
            if let month = item["month"] as? Int, let day = item["day"] as? Int {
                return String(format: "%02d/%02d", month, day)
            }
            return nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            connector.debugLog.append("Nav error: \(error.localizedDescription)")
            Task { await connector.shipDebugLog(tag: "facebook-nav-error") }
        }
    }

    // Extracts friend/user data from both Relay JSON blobs and visible DOM.
    // Runs on any FB page — harmless if the page has no friends data.
    private static let extractJS = """
    (function() {
        var byId = {};
        function addOrMerge(id, obj) {
            if (!id || !obj.name || obj.name.length < 2 || obj.name.length > 80) return;
            var e = byId[id] || { profileId: id, name: obj.name };
            if (obj.profileUrl && !e.profileUrl) e.profileUrl = obj.profileUrl;
            if (obj.hometown && !e.hometown) e.hometown = obj.hometown;
            if (obj.location && !e.location) e.location = obj.location;
            if (obj.month && !e.month) { e.month = obj.month; e.day = obj.day; }
            byId[id] = e;
        }

        // 1. Try to parse Relay __bbox / require JSON blobs
        var scripts = document.querySelectorAll('script');
        for (var s of scripts) {
            var t = s.textContent || '';
            if (t.length < 50 || (!t.includes('"name"') && !t.includes("'name'"))) continue;
            // Find JSON objects containing "id" and "name"
            var matches = t.matchAll(/\\{"[^"]*"id":"(\\d{6,})"[^{}]{0,500}"name":"([^"\\\\]{2,80})"[^{}]{0,500}\\}/g);
            for (var m of matches) {
                try {
                    var obj = JSON.parse(m[0]);
                    var entry = { name: obj.name };
                    if (obj.url) entry.profileUrl = obj.url.replace(/\\\\/g,'');
                    if (obj.hometown) entry.hometown = (obj.hometown.name || obj.hometown);
                    if (obj.current_city) entry.location = (obj.current_city.name || obj.current_city);
                    if (obj.birthdate) { entry.month = obj.birthdate.month; entry.day = obj.birthdate.day; }
                    addOrMerge(m[1], entry);
                } catch(e) {}
            }
            // Simpler id+name regex for fragmented payloads
            var simple = t.matchAll(/"id":"(\\d{6,})","name":"([^"\\\\]{2,80})"/g);
            for (var sm of simple) {
                addOrMerge(sm[1], { name: sm[2] });
            }
            // Birthday dates
            var bdates = t.matchAll(/"id":"(\\d{6,})"[^}]{0,300}"birthdate":\\{"day":(\\d+),"month":(\\d+)/g);
            for (var bd of bdates) {
                if (byId[bd[1]]) { byId[bd[1]].month = parseInt(bd[3]); byId[bd[1]].day = parseInt(bd[2]); }
            }
        }

        // 2. DOM fallback — works even when JS bundle is loaded async
        var SKIP = new Set(['home','friends','events','groups','watch','marketplace','me','messages','notifications','settings','pages','reels','gaming','fundraisers','saved','memories','weather','jobs','live','adsmanager','login','register','help','privacy','cookies','terms','about','instagram']);
        var links = document.querySelectorAll('a[href]');
        for (var a of links) {
            var href = a.getAttribute('href') || '';
            var fullHref = href.startsWith('http') ? href : ('https://www.facebook.com' + href);
            var name = (a.textContent || a.innerText || '').trim().split('\\n')[0].trim();
            if (!name || name.length < 2 || name.length > 80) continue;

            var idM = href.match(/[?&]id=(\\d{6,})/);
            if (idM) {
                addOrMerge(idM[1], { name: name, profileUrl: fullHref.split('?')[0] + '?id=' + idM[1] });
                continue;
            }
            var vanM = href.match(/^\\/([a-zA-Z0-9.]{5,50})(?:\\?|$|\\/)/);
            if (vanM && !SKIP.has(vanM[1].toLowerCase())) {
                addOrMerge('v:' + vanM[1], { name: name, profileUrl: 'https://www.facebook.com/' + vanM[1] });
            }
        }

        return JSON.stringify(Object.values(byId).slice(0, 5000));
    })();
    """
}

struct FacebookImportSheet: View {
    @ObservedObject var connector: FacebookConnector
    @Environment(\.dismiss) private var dismiss
    @State private var showingDebug = false

    var body: some View {
        NavigationStack {
            ZStack {
                FacebookWebView(connector: connector) { dismiss() }
                    .ignoresSafeArea(edges: .bottom)

                VStack {
                    Spacer()
                    statusPill
                        .padding(.bottom, 24)
                }
            }
            .navigationTitle("Connect Facebook")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Debug") { showingDebug = true }
                        .font(.caption)
                }
            }
            .sheet(isPresented: $showingDebug) {
                debugSheet
            }
        }
    }

    @ViewBuilder
    private var statusPill: some View {
        let count = connector.extractedContacts.count
        switch connector.phase {
        case .loggingIn:
            EmptyView()
        case .scanning(let page):
            pill(icon: "arrow.clockwise", text: "Scanning \(page)… \(count > 0 ? "(\(count) found so far)" : "")")
        case .done(let n):
            pill(icon: "checkmark.circle.fill", text: "Done — \(n) contacts imported")
        case .failed(let msg):
            pill(icon: "exclamationmark.triangle", text: msg)
        case .idle:
            EmptyView()
        }
    }

    private func pill(icon: String, text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
            Text(text).font(.subheadline)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(.regularMaterial)
        .clipShape(Capsule())
    }

    private var debugSheet: some View {
        NavigationStack {
            List {
                Section("Extracted contacts (\(connector.extractedContacts.count))") {
                    ForEach(connector.extractedContacts.prefix(50), id: \.profileId) { c in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.name).font(.subheadline.bold())
                            if let url = c.profileUrl { Text(url).font(.caption2).foregroundStyle(.secondary) }
                            if let h = c.hometown { Text("Hometown: \(h)").font(.caption2).foregroundStyle(.secondary) }
                        }
                    }
                }
                Section("Navigation log") {
                    ForEach(Array(connector.debugLog.enumerated()), id: \.offset) { _, line in
                        Text(line).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Debug")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { showingDebug = false }
                }
            }
        }
    }
}
