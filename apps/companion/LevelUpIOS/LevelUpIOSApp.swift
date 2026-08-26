import LevelUpFeature
import SwiftUI

@main
struct LevelUpIOSApp: App {
    @StateObject private var model = LevelUpAppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
#if DEBUG
            LevelUpRootView(dataSource: DemoWorkoutDataSource())
                .safeAreaInset(edge: .top, spacing: 0) {
                    Text("TEST BUILD · Sample data stays on this phone")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color(red: 0.173, green: 0.149, blue: 0.125))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(Color(red: 0.835, green: 0.742, blue: 0.635))
                }
#else
            LevelUpShell()
                .environmentObject(model)
                .task { await model.start() }
#endif
        }
        .onChange(of: scenePhase) { _, phase in
            let value: String
            switch phase {
            case .active: value = "active"
            case .inactive: value = "inactive"
            case .background: value = "background"
            @unknown default: value = "unknown"
            }
            DiagnosticLog.shared.record("scene_changed", category: "lifecycle", detail: "phase=\(value)")
        }
    }
}
