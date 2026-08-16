import PersonsFeature
import SwiftUI

struct PersonsShell: View {
    @EnvironmentObject var model: PersonsAppModel

    private let linen = Color(red: 0.914, green: 0.89, blue: 0.847)
    private let surface = Color(red: 0.969, green: 0.957, blue: 0.933)
    private let ink = Color(red: 0.153, green: 0.137, blue: 0.118)
    private let mutedInk = Color(red: 0.39, green: 0.35, blue: 0.31)
    private let cognac = Color(red: 0.561, green: 0.42, blue: 0.29)

    var body: some View {
        Group {
            if model.signedIn, let api = model.api {
                VStack(spacing: 0) {
                    syncStatusBar
                    PersonsRootView(api: api)
                }
            } else {
                ZStack {
                    linen.ignoresSafeArea()
                    VStack(alignment: .leading, spacing: 18) {
                        Text("Persons")
                            .font(.system(size: 42, design: .serif))
                            .foregroundStyle(ink)
                        Text("Your personal CRM for remembering people, context, and the relationships you want to nurture.")
                            .foregroundStyle(mutedInk)
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Connect your workspace")
                                .font(.headline)
                                .foregroundStyle(ink)
                            Text("Approve this app using your existing Life OS web account. Persons stores its own revocable credential and does not request Health, Location, or Photos access — only Contacts, to keep your people in sync.")
                                .font(.subheadline)
                                .foregroundStyle(mutedInk)
                            Button("Connect Persons") { model.connect() }
                                .buttonStyle(.borderedProminent)
                                .tint(cognac)
                        }
                        .padding(18)
                        .background(surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        if let error = model.errorMessage {
                            Text(error).font(.caption).foregroundStyle(.red)
                        }
                    }
                    .padding(24)
                }
            }
        }
        .preferredColorScheme(.light)
    }

    @ViewBuilder
    private var syncStatusBar: some View {
        HStack(spacing: 12) {
            if model.contactsStatus.enabled {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.syncMessage).font(.caption).foregroundStyle(mutedInk)
                    if let lastSync = model.lastSync {
                        Text("Last synced \(lastSync.formatted(.relative(presentation: .named)))").font(.caption2).foregroundStyle(mutedInk.opacity(0.7))
                    }
                }
                Spacer()
                Button(model.isSyncing ? "Syncing…" : "Sync Now") { Task { await model.syncNow() } }
                    .font(.caption)
                    .disabled(model.isSyncing)
            } else {
                Text("Contacts sync is off").font(.caption).foregroundStyle(mutedInk)
                Spacer()
                Button("Enable Contacts") { Task { await model.enableContacts() } }
                    .font(.caption)
                    .tint(cognac)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(surface)
    }
}
