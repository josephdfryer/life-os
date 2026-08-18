import PersonsFeature
import SwiftUI
import UIKit

struct PersonsShell: View {
    @EnvironmentObject var model: PersonsAppModel
    @State private var showingAccount = false

    private let linen = Color(red: 0.914, green: 0.89, blue: 0.847)
    private let surface = Color(red: 0.969, green: 0.957, blue: 0.933)
    private let ink = Color(red: 0.153, green: 0.137, blue: 0.118)
    private let mutedInk = Color(red: 0.39, green: 0.35, blue: 0.31)
    private let cognac = Color(red: 0.561, green: 0.42, blue: 0.29)

    var body: some View {
        Group {
            if model.signedIn, let api = model.api {
                VStack(spacing: 0) {
                    if model.contactsStatus.enabled {
                        syncStatusBar
                        PersonsRootView(api: api)
                    } else {
                        contactsWalkthrough
                    }
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

    @ViewBuilder
    private var syncStatusBar: some View {
        VStack(spacing: 6) {
            HStack(spacing: 12) {
                Button { showingAccount = true } label: {
                    Image(systemName: "person.crop.circle")
                        .foregroundStyle(mutedInk)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.syncMessage).font(.caption).foregroundStyle(mutedInk)
                    HStack(spacing: 4) {
                        Text("\(model.totalContacts) contacts")
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

    @ViewBuilder
    private var contactsWalkthrough: some View {
        ZStack {
            linen.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button { showingAccount = true } label: {
                        Image(systemName: "person.crop.circle")
                            .foregroundStyle(mutedInk)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                Spacer()

                VStack(spacing: 32) {
                    // Overlapping logo circles
                    ZStack {
                        Circle()
                            .fill(Color(red: 0.91, green: 0.88, blue: 0.84))
                            .frame(width: 72, height: 72)
                            .overlay(
                                Image(systemName: "person.2.fill")
                                    .font(.system(size: 28))
                                    .foregroundStyle(mutedInk)
                            )
                            .offset(x: -20)
                        Circle()
                            .fill(cognac)
                            .frame(width: 72, height: 72)
                            .overlay(
                                Text("P")
                                    .font(.system(size: 32, weight: .semibold, design: .serif))
                                    .foregroundStyle(.white)
                            )
                            .offset(x: 20)
                    }
                    .frame(height: 80)

                    VStack(spacing: 10) {
                        Text("Bring in your people")
                            .font(.system(size: 26, design: .serif))
                            .foregroundStyle(ink)
                        Text("We will seamlessly sync your phone contacts to Persons in one easy step.")
                            .font(.subheadline)
                            .foregroundStyle(mutedInk)
                            .multilineTextAlignment(.center)
                    }

                    VStack(alignment: .leading, spacing: 18) {
                        syncBenefit(
                            title: "Secure",
                            detail: "All your contacts are imported locally. Your information is encrypted end-to-end."
                        )
                        syncBenefit(
                            title: "Private",
                            detail: "Persons never has access to your Contacts app directly. Everything syncs on device."
                        )
                    }
                    .padding(20)
                    .background(surface)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                    VStack(spacing: 14) {
                        Button {
                            Task { await model.enableContacts() }
                        } label: {
                            if model.isSyncing || model.syncMessage == "Requesting Contacts access…" {
                                HStack { ProgressView().tint(.white); Text("Requesting Access…") }
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("Sync Contacts")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(cognac)
                        .controlSize(.large)

                        if model.contactsStatus.permissionStatus == .denied {
                            Button("Open Settings to Allow Contacts Access") {
                                if let url = URL(string: UIApplication.openSettingsURLString) {
                                    UIApplication.shared.open(url)
                                }
                            }
                            .font(.caption)
                            .foregroundStyle(mutedInk)
                        } else {
                            Text("By syncing you agree to our privacy policy.")
                                .font(.caption)
                                .foregroundStyle(mutedInk.opacity(0.7))
                        }
                    }
                }
                .padding(.horizontal, 28)

                Spacer()
                Spacer()
            }
        }
    }

    private func syncBenefit(title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "checkmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(cognac)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.bold())
                    .foregroundStyle(ink)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(mutedInk)
            }
        }
    }
}
