import SwiftUI
import WebKit

// Full-screen sheet that hosts the Facebook login + scrape flow.
// The WKWebView session is ephemeral — cookies are cleared after import.
struct FacebookWebView: UIViewRepresentable {
    @ObservedObject var connector: FacebookConnector
    let onDone: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(connector: connector, onDone: onDone)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Ephemeral: don't persist cookies to the shared store
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(context.coordinator, name: "fbExtract")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        let url = URL(string: "https://m.facebook.com/login/")!
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let connector: FacebookConnector
        let onDone: () -> Void
        weak var webView: WKWebView?
        private var scannedBirthdays = false
        private var scannedFriends = false

        init(connector: FacebookConnector, onDone: @escaping () -> Void) {
            self.connector = connector
            self.onDone = onDone
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            let url = webView.url?.absoluteString ?? ""

            // Detect successful login: Facebook redirects to home or feed
            let isLoggedIn = url.contains("m.facebook.com") &&
                !url.contains("/login") &&
                !url.contains("/checkpoint") &&
                !url.contains("/two_step")

            guard isLoggedIn else {
                if url.contains("/login") || url.isEmpty {
                    Task { @MainActor in self.connector.phase = .loggingIn }
                }
                return
            }

            // Step 1: scan birthdays page
            if !scannedBirthdays && !url.contains("birthdays") {
                scannedBirthdays = true
                Task { @MainActor in self.connector.phase = .scanning(page: "birthdays") }
                webView.load(URLRequest(url: URL(string: "https://m.facebook.com/events/birthdays/")!))
                return
            }

            // Step 2: extract birthdays, then go to friends list
            if url.contains("birthdays") {
                webView.evaluateJavaScript(FacebookConnector.birthdayExtractionJS) { [weak self] result, _ in
                    self?.handleExtraction(result, phase: "friends") { webView in
                        if !(self?.scannedFriends ?? true) {
                            self?.scannedFriends = true
                            Task { @MainActor in self?.connector.phase = .scanning(page: "friends") }
                            webView.load(URLRequest(url: URL(string: "https://m.facebook.com/friends/center/friends/")!))
                        }
                    }
                }
                return
            }

            // Step 3: extract friends list
            if url.contains("friends") && scannedBirthdays {
                webView.evaluateJavaScript(FacebookConnector.friendsListJS) { [weak self] result, _ in
                    self?.handleExtraction(result, phase: "done") { _ in
                        Task { @MainActor in
                            await self?.connector.enqueueAll()
                            self?.onDone()
                        }
                    }
                }
            }
        }

        private func handleExtraction(
            _ result: Any?,
            phase: String,
            then next: @escaping (WKWebView) -> Void
        ) {
            guard let json = result as? String,
                  let data = json.data(using: .utf8),
                  let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                next(webView!)
                return
            }
            Task { @MainActor in
                for item in array {
                    guard let id = item["profileId"] as? String,
                          let name = item["name"] as? String,
                          !name.isEmpty else { continue }
                    let birthday = birthdayString(from: item)
                    // Merge: if we already have this profileId, add birthday if missing
                    if let idx = self.connector.extractedContacts.firstIndex(where: { $0.profileId == id }) {
                        if self.connector.extractedContacts[idx].birthday == nil, let bday = birthday {
                            self.connector.extractedContacts[idx].birthday = bday
                        }
                    } else {
                        self.connector.extractedContacts.append(
                            FacebookConnector.FacebookContact(name: name, profileId: id, birthday: birthday)
                        )
                    }
                }
                if let wv = self.webView { next(wv) }
            }
        }

        private func birthdayString(from item: [String: Any]) -> String? {
            if let month = item["month"] as? Int, let day = item["day"] as? Int {
                return String(format: "%02d/%02d", month, day)
            }
            return nil
        }

        // WKScriptMessageHandler (unused currently — JS posts via evaluateJavaScript instead)
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {}

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in
                self.connector.phase = .failed("Network error: \(error.localizedDescription)")
            }
        }
    }
}

// Sheet wrapper shown from ConnectionsView
struct FacebookImportSheet: View {
    @ObservedObject var connector: FacebookConnector
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                FacebookWebView(connector: connector) {
                    dismiss()
                }
                .ignoresSafeArea(edges: .bottom)

                // Overlay status during scanning
                if case .scanning(let page) = connector.phase {
                    VStack(spacing: 12) {
                        Spacer()
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Scanning \(page)…")
                                .font(.subheadline)
                        }
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(.regularMaterial)
                        .clipShape(Capsule())
                        .padding(.bottom, 24)
                    }
                }
            }
            .navigationTitle("Connect Facebook")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
