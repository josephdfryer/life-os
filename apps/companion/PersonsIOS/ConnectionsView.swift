import SwiftUI
import UIKit

struct ConnectionsView: View {
    @EnvironmentObject var model: PersonsAppModel
    @State private var showingFacebookImport = false

    var body: some View {
        List {
            Section("Phone Contacts") {
                LabeledContent("Status", value: model.contactsStatus.enabled ? "Connected" : "Not connected")
                LabeledContent("Contacts found", value: "\(model.totalContacts)")
                LabeledContent("Pending upload", value: "\(model.pendingCount)")
                if let lastSync = model.lastSync {
                    LabeledContent("Last synced", value: lastSync.formatted(.relative(presentation: .named)))
                }
                if model.contactsStatus.enabled {
                    Button(model.isSyncing ? "Syncing…" : "Sync Now") { Task { await model.syncNow() } }
                        .disabled(model.isSyncing)
                } else {
                    Button("Import Contacts") { Task { await model.enableContacts() } }
                }
            }

            Section {
                LabeledContent("Status", value: model.calendarStatus.enabled ? "Connected" : "Not connected")
                if model.calendarStatus.enabled {
                    LabeledContent("Attendees found", value: "\(model.calendarAttendeeCount)")
                    Button(model.isSyncing ? "Syncing…" : "Sync Now") { Task { await model.syncNow() } }
                        .disabled(model.isSyncing)
                } else {
                    Button("Connect Calendar") { Task { await model.enableCalendar() } }
                }
            } header: {
                Text("Calendar Attendees")
            } footer: {
                Text("Persons scans the past 90 days of calendar events and imports anyone you've met in a meeting. Only names and emails are captured — nothing else.")
            }

            Section {
                let fbPhase = model.facebook.phase
                LabeledContent("Status", value: fbStatusLabel(fbPhase))
                if case .done(let count) = fbPhase {
                    LabeledContent("Imported", value: "\(count) friends")
                }
                Button(fbButtonLabel(fbPhase)) {
                    model.facebook.reset()
                    showingFacebookImport = true
                }
                .disabled(isFbBusy(fbPhase))
            } header: {
                Text("Facebook Friends")
            } footer: {
                Text("Signs in to Facebook in a private browser window on your device. Persons scans your friends list and birthday page locally — your Facebook password never leaves your phone.")
            }

            Section {
                let gc = model.googleContacts
                LabeledContent("Status", value: gc.status.enabled ? "Connected" : "Not connected")
                if gc.status.enabled {
                    LabeledContent("Imported", value: "\(gc.importedCount) contacts")
                    Button(gc.isImporting ? "Importing…" : "Re-import") {
                        Task { await gc.importContacts() }
                    }
                    .disabled(gc.isImporting)
                    Button("Disconnect", role: .destructive) { gc.disconnect() }
                } else if !gc.isConfigured {
                    Text("Add GoogleOAuthClientId to Info.plist to enable.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Button(gc.isImporting ? "Connecting…" : "Connect Google") {
                        Task { await gc.authorize() }
                    }
                    .disabled(gc.isImporting)
                }
                if let err = gc.errorMessage {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
            } header: {
                Text("Google Contacts")
            } footer: {
                Text("Imports your Google contacts including names, emails, phone numbers, and birthdays. Requires a separate Google sign-in scoped to Contacts read access only.")
            }
        }
        .navigationTitle("Connections")
        .sheet(isPresented: $showingFacebookImport) {
            FacebookImportSheet(connector: model.facebook)
        }
    }

    private func fbStatusLabel(_ phase: FacebookConnector.ImportPhase) -> String {
        switch phase {
        case .idle: return "Not connected"
        case .loggingIn: return "Signing in…"
        case .scanning(let p): return "Scanning \(p)…"
        case .done: return "Imported"
        case .failed: return "Error"
        }
    }

    private func fbButtonLabel(_ phase: FacebookConnector.ImportPhase) -> String {
        switch phase {
        case .done: return "Re-import Friends"
        case .loggingIn, .scanning: return "Importing…"
        default: return "Import Friends"
        }
    }

    private func isFbBusy(_ phase: FacebookConnector.ImportPhase) -> Bool {
        switch phase {
        case .loggingIn, .scanning: return true
        default: return false
        }
    }
}
