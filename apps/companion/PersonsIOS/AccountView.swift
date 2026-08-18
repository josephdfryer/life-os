import SwiftUI

struct AccountView: View {
    @EnvironmentObject var model: PersonsAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingReset = false
    @State private var isResetting = false

    var body: some View {
        NavigationStack {
            List {
                Section("Connected workspace") {
                    LabeledContent("Workspace ID", value: model.workspaceId ?? "—")
                        .textSelection(.enabled)
                    NavigationLink("Connections") { ConnectionsView().environmentObject(model) }
                }
                Section {
                    Button(role: .destructive) {
                        confirmingReset = true
                    } label: {
                        if isResetting {
                            HStack { ProgressView(); Text("Resetting…") }
                        } else {
                            Text("Log Out & Reset This Device")
                        }
                    }
                    .disabled(isResetting)
                } footer: {
                    Text("Signs out, deletes the local sync queue, and clears Contacts sync state on this device so you can connect a different workspace and test import/onboarding from scratch. Nothing on the server is deleted.")
                }
            }
            .navigationTitle("Account")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog(
                "Log out and reset this device?",
                isPresented: $confirmingReset,
                titleVisibility: .visible
            ) {
                Button("Log Out & Reset", role: .destructive) {
                    Task {
                        isResetting = true
                        await model.resetEnvironment()
                        isResetting = false
                        dismiss()
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This clears local sync state and signs out of the current workspace. You can immediately connect a different one.")
            }
        }
    }
}
