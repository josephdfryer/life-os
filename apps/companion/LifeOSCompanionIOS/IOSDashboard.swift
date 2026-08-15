import SwiftUI
import PersonsFeature

struct IOSDashboard: View {
    @EnvironmentObject var model: IOSCompanionModel
    private let linen = Color(red: 0.914, green: 0.89, blue: 0.847), surface = Color(red: 0.969, green: 0.957, blue: 0.933), cognac = Color(red: 0.561, green: 0.42, blue: 0.29)
    var body: some View {
        Group {
            if model.signedIn, let api = model.api {
                TabView {
                    PersonsRootView(api: api)
                        .tabItem { Label("People", systemImage: "person.2") }
                    connections
                        .tabItem { Label("Connections", systemImage: "arrow.triangle.2.circlepath") }
                }
                .tint(cognac)
            } else {
                connections
            }
        }
    }
    private var connections: some View { NavigationStack { ZStack { linen.ignoresSafeArea(); ScrollView { VStack(alignment: .leading, spacing: 18) { Text("Your day, in context").font(.system(size: 32, design: .serif)); Text("Health summaries and meaningful visits sync privately to Life OS. Granular samples and raw location pings stay on this iPhone.").foregroundStyle(.secondary); status("Health", detail: model.healthStatus.healthStatus.rawValue, icon: "heart.fill"); status("Location", detail: model.locationStatus.permissionStatus.rawValue, icon: "location.fill"); status("Waiting to sync", detail: "\(model.pendingCount) records", icon: "arrow.triangle.2.circlepath"); if !model.signedIn { Button("Sign in to Life OS") { model.signIn() }.buttonStyle(.borderedProminent).tint(cognac) } else { Button("Sync now") { Task { await model.sync() } }.buttonStyle(.borderedProminent).tint(cognac) }; if let date = model.lastSync { Text("Last synced \(date.formatted(.relative(presentation: .named)))").font(.caption).foregroundStyle(.secondary) } }.padding(22) } } }.tint(cognac) }
    private func status(_ title: String, detail: String, icon: String) -> some View { HStack(spacing: 14) { Image(systemName: icon).foregroundStyle(cognac).frame(width: 28); VStack(alignment: .leading) { Text(title); Text(detail.replacingOccurrences(of: "_", with: " ").capitalized).font(.caption).foregroundStyle(.secondary) }; Spacer() }.padding(18).background(surface).clipShape(RoundedRectangle(cornerRadius: 12)) }
}
