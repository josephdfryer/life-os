import LevelUpFeature
import SwiftUI

struct LevelUpShell: View {
    @EnvironmentObject private var model: LevelUpAppModel

    var body: some View {
        Group {
            if model.isStarting {
                ProgressView("Opening Level Up…")
            } else if model.signedIn, let api = model.api {
                LevelUpRootView(api: api)
            } else {
                connectView
            }
        }
        .background(LevelUpShellStyle.background.ignoresSafeArea())
        .alert("Level Up needs attention", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(model.errorMessage ?? "") }
    }

    private var connectView: some View {
        VStack(alignment: .leading, spacing: 22) {
            Spacer()
            Image(systemName: "arrow.up.forward.circle.fill")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(LevelUpShellStyle.cognac)
            VStack(alignment: .leading, spacing: 10) {
                Text("Level Up")
                    .font(.system(size: 42, design: .serif))
                    .foregroundStyle(LevelUpShellStyle.ink)
                Text("Build capability through honest evidence—starting with fitness and health.")
                    .font(.title3)
                    .foregroundStyle(LevelUpShellStyle.secondaryInk)
            }
            Button("Connect your LifeOS workspace") { model.connect() }
                .buttonStyle(.borderedProminent)
                .tint(LevelUpShellStyle.cognac)
                .controlSize(.large)
                .clipShape(Capsule())
            Text("Your workout science, history, and provenance stay in your existing LifeOS workspace. This app receives only the device scopes it needs.")
                .font(.footnote)
                .foregroundStyle(LevelUpShellStyle.mutedInk)
            Spacer()
        }
        .padding(28)
    }
}

private enum LevelUpShellStyle {
    static let background = Color(red: 0.914, green: 0.890, blue: 0.847)
    static let ink = Color(red: 0.173, green: 0.149, blue: 0.125)
    static let secondaryInk = Color(red: 0.322, green: 0.290, blue: 0.259)
    static let mutedInk = Color(red: 0.478, green: 0.447, blue: 0.408)
    static let cognac = Color(red: 0.561, green: 0.420, blue: 0.290)
}
