import BackgroundTasks
import SwiftUI

@main
struct PersonsIOSApp: App {
    @StateObject private var model = PersonsAppModel()

    var body: some Scene {
        WindowGroup {
            PersonsShell()
                .environmentObject(model)
                .task { await model.start() }
        }
        .backgroundTask(.appRefresh(PersonsBackground.refreshTaskId)) { await model.backgroundRefresh() }
    }
}
