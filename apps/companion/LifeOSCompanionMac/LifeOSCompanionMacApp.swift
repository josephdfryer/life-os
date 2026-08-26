import SwiftUI
import LifeOSCompanionCore
import Sparkle

@main
struct LifeOSCompanionMacApp: App {
    @NSApplicationDelegateAdaptor(CompanionAppDelegate.self) private var appDelegate
    @StateObject private var model = MacCompanionModel()
    var body: some Scene {
        WindowGroup { MacDashboard().environmentObject(model).frame(minWidth: 760, minHeight: 560) }
        MenuBarExtra("LifeOS", systemImage: model.isPaused ? "pause.circle" : "circle.hexagongrid.fill") {
            Button(model.isPaused ? "Resume collection" : "Pause collection") { model.togglePause() }
            Button("Sync now") { Task { await model.syncNow() } }.disabled(model.isPaused)
            Divider(); Button("Open LifeOS Companion") { NSApp.activate(ignoringOtherApps: true); NSApp.windows.first?.makeKeyAndOrderFront(nil) }
        }
    }
}

final class CompanionAppDelegate: NSObject, NSApplicationDelegate {
    private var updater: SPUStandardUpdaterController?
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let feed = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String, !feed.isEmpty,
              let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String, !key.isEmpty else { return }
        updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    }
}
