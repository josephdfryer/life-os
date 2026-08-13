import BackgroundTasks
import SwiftUI

@main
struct LifeOSCompanionIOSApp: App {
    @StateObject private var model = IOSCompanionModel()
    var body: some Scene {
        WindowGroup { IOSDashboard().environmentObject(model).task { await model.start() } }
            .backgroundTask(.appRefresh("com.lacollecteur.lifeos.companion.refresh")) { await model.backgroundRefresh() }
    }
}
