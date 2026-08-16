import LifeOSCompanionCore
import SwiftUI

struct IOSDashboard: View {
    @EnvironmentObject var model: IOSCompanionModel

    private let linen = Color(red: 0.914, green: 0.89, blue: 0.847)
    private let surface = Color(red: 0.969, green: 0.957, blue: 0.933)
    private let ink = Color(red: 0.153, green: 0.137, blue: 0.118)
    private let mutedInk = Color(red: 0.39, green: 0.35, blue: 0.31)
    private let cognac = Color(red: 0.561, green: 0.42, blue: 0.29)

    var body: some View {
        connections
        // Still currently defines a light palette. Pinning the appearance prevents
        // system dark-mode text from being drawn over the light linen surfaces.
        .preferredColorScheme(.light)
    }

    private var connections: some View {
        NavigationStack {
            ZStack {
                linen.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("Your day, in context")
                            .font(.system(size: 32, design: .serif))
                            .foregroundStyle(ink)

                        Text("Sleep syncs when last night lands in Health. The rest of the day waits until about 11:50 PM. Raw samples, photo bytes, and raw location pings stay on this iPhone.")
                            .foregroundStyle(mutedInk)

                        if !model.signedIn {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Connect to your workspace")
                                    .font(.headline)
                                    .foregroundStyle(ink)
                                Text("Approve this iPhone using your existing Life OS web account. This creates a revocable device connection—not a new account—and lets the app load your People data.")
                                    .font(.subheadline)
                                    .foregroundStyle(mutedInk)
                                Button("Connect this iPhone") { model.signIn() }
                                    .buttonStyle(.borderedProminent)
                                    .tint(cognac)
                            }
                            .padding(18)
                            .background(surface)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        } else {
                            connector(
                                "Health",
                                detail: "Sleep when it exists; activity, nutrition, and vitals at the end of the day",
                                status: model.healthStatus,
                                icon: "heart.fill",
                                action: "Set up Health"
                            ) { await model.enableHealth() }
                            connector(
                                "Location",
                                detail: "Battery-conscious significant visits",
                                status: model.locationStatus,
                                icon: "location.fill",
                                action: "Set up Location"
                            ) { model.enableLocation() }
                            connector(
                                "Photos",
                                detail: "Metadata for new photos; image bytes stay here",
                                status: model.photoStatus,
                                icon: "photo.on.rectangle",
                                action: "Set up Photos"
                            ) { await model.enablePhotos() }

                            status(model.syncMessage, detail: "\(model.pendingCount) waiting on this iPhone", icon: model.isSyncing ? "arrow.triangle.2.circlepath" : "checkmark.icloud")
                            Button {
                                Task { await model.syncNow() }
                            } label: {
                                HStack(spacing: 8) {
                                    if model.isSyncing { ProgressView().tint(.white) }
                                    Text(model.isSyncing ? "Syncing…" : "Sync now")
                                }
                                .frame(maxWidth: .infinity)
                            }
                                .buttonStyle(.borderedProminent)
                                .tint(cognac)
                                .disabled(model.isSyncing)
                        }

                        if let date = model.lastSync {
                            Text("Last synced \(date.formatted(.relative(presentation: .named)))")
                                .font(.caption)
                                .foregroundStyle(mutedInk)
                        }
                    }
                    .padding(22)
                }
            }
        }
        .tint(cognac)
    }

    private func connector(
        _ title: String,
        detail: String,
        status: ConnectorStatus,
        icon: String,
        action: String,
        perform: @escaping @MainActor () async -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                Image(systemName: icon).foregroundStyle(cognac).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(ink)
                    Text(detail).font(.caption).foregroundStyle(mutedInk)
                }
                Spacer()
                Text(status.permissionStatus.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(status.permissionStatus == .granted ? cognac : mutedInk)
            }
            if !status.enabled {
                Button(action) { Task { await perform() } }
                    .buttonStyle(.bordered)
                    .tint(cognac)
            }
        }
        .padding(18)
        .background(surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func status(_ title: String, detail: String, icon: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .foregroundStyle(cognac)
                .frame(width: 28)
            VStack(alignment: .leading) {
                Text(title).foregroundStyle(ink)
                Text(detail.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.caption)
                    .foregroundStyle(mutedInk)
            }
            Spacer()
        }
        .padding(18)
        .background(surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
