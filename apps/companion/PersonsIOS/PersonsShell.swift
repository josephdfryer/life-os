import PersonsFeature
import SwiftUI
import UIKit

struct PersonsShell: View {
    @EnvironmentObject var model: PersonsAppModel
    @State private var showingAccount = false
    // People is the product; syncing the address book is an offer, not a
    // toll gate. A user who declines Contacts (or just wants to look first)
    // still gets the whole app, and the offer stays one tap away under
    // Account → Connections after being dismissed.
    @AppStorage("persons.contactsPromptDismissed") private var contactsPromptDismissed = false

    private let linen = Color(red: 0.914, green: 0.89, blue: 0.847)
    private let surface = Color(red: 0.969, green: 0.957, blue: 0.933)
    private let ink = Color(red: 0.153, green: 0.137, blue: 0.118)
    private let mutedInk = Color(red: 0.39, green: 0.35, blue: 0.31)
    private let cognac = Color(red: 0.561, green: 0.42, blue: 0.29)

    var body: some View {
        Group {
            if model.signedIn, let api = model.api {
                VStack(spacing: 0) {
                    headerBar
                    if !model.contactsStatus.enabled && !contactsPromptDismissed {
                        contactsUpsellCard
                    }
                    PersonsRootView(api: api)
                }
                .sheet(isPresented: $showingAccount) {
                    AccountView().environmentObject(model)
                }
            } else {
                ZStack {
                    linen.ignoresSafeArea()
                    VStack(spacing: 28) {
                        Spacer()

                        VStack(spacing: 10) {
                            Text("Persons")
                                .font(.system(size: 48, design: .serif))
                                .foregroundStyle(ink)
                            Text("Your personal CRM for remembering people, context, and the relationships you want to nurture.")
                                .font(.subheadline)
                                .foregroundStyle(mutedInk)
                                .multilineTextAlignment(.center)
                        }

                        Spacer()

                        VStack(spacing: 12) {
                            Button {
                                model.connect()
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "g.circle.fill")
                                    Text("Sign in with Google")
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(cognac)
                            .controlSize(.large)

                            if let error = model.errorMessage {
                                Text(error).font(.caption).foregroundStyle(.red)
                            }
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 40)
                    .padding(.bottom, 24)
                }
            }
        }
        .preferredColorScheme(.light)
    }

    private var anyConnectorEnabled: Bool {
        model.contactsStatus.enabled || model.calendarStatus.enabled
    }

    @ViewBuilder
    private var headerBar: some View {
        VStack(spacing: 6) {
            HStack(spacing: 12) {
                Button { showingAccount = true } label: {
                    Image(systemName: "person.crop.circle")
                        .foregroundStyle(mutedInk)
                }
                .accessibilityLabel("Account")
                if anyConnectorEnabled {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.syncMessage).font(.caption).foregroundStyle(mutedInk)
                        HStack(spacing: 4) {
                            if model.contactsStatus.enabled {
                                Text("\(model.totalContacts) contacts")
                            }
                            if let lastSync = model.lastSync {
                                Text("· Last synced \(lastSync.formatted(.relative(presentation: .named)))")
                            }
                        }
                        .font(.caption2)
                        .foregroundStyle(mutedInk.opacity(0.7))
                    }
                    Spacer()
                    Button(model.isSyncing ? "Syncing…" : "Sync Now") { Task { await model.syncNow() } }
                        .font(.caption)
                        .disabled(model.isSyncing)
                } else {
                    Text("No sources connected")
                        .font(.caption)
                        .foregroundStyle(mutedInk)
                    Spacer()
                }
            }
            if let progress = model.syncProgress {
                ProgressView(value: progress)
                    .tint(cognac)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(surface)
    }

    // The former full-screen walkthrough, reduced to an offer that sits above
    // the list. Same copy, same action; the difference is the list is
    // already there underneath it.
    @ViewBuilder
    private var contactsUpsellCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(cognac)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Bring in your people")
                        .font(.system(size: 17, design: .serif))
                        .foregroundStyle(ink)
                    Text("Sync your phone contacts to Persons. Names, emails, and phone numbers only — nothing else is touched.")
                        .font(.footnote)
                        .foregroundStyle(mutedInk)
                }
            }
            HStack(spacing: 12) {
                Button {
                    Task { await model.enableContacts() }
                } label: {
                    if model.syncMessage == "Requesting Contacts access…" {
                        HStack { ProgressView().tint(.white); Text("Requesting…") }
                    } else {
                        Text("Sync Contacts")
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(cognac)
                .controlSize(.small)
                if model.contactsStatus.permissionStatus == .denied {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(mutedInk)
                }
                Spacer()
                Button("Not now") { contactsPromptDismissed = true }
                    .font(.footnote)
                    .foregroundStyle(mutedInk)
            }
        }
        .padding(14)
        .background(surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .background(linen)
    }
}
