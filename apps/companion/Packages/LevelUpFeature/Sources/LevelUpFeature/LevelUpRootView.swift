import LifeOSCompanionCore
import SwiftUI

public struct LevelUpRootView: View {
    @StateObject private var model: LevelUpModel
    @State private var selectedTab = "today"

    public init(api: APIClient) {
        _model = StateObject(wrappedValue: LevelUpModel(dataSource: WorkoutClient(api: api)))
    }

    public init(dataSource: any WorkoutDataSource) {
        _model = StateObject(wrappedValue: LevelUpModel(dataSource: dataSource))
    }

    public var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack { TodayView(model: model) }
                .tabItem { Label("Today", systemImage: "sun.max") }
                .tag("today")
            NavigationStack { PlansView(model: model) }
                .tabItem { Label("Plans", systemImage: "list.bullet.rectangle.portrait") }
                .tag("plans")
            PlaceholderSection(title: "Journey", message: "Ranks, combines, milestones, and honest progress over time.", symbol: "chart.line.uptrend.xyaxis")
                .tabItem { Label("Journey", systemImage: "chart.line.uptrend.xyaxis") }
                .tag("journey")
            NavigationStack { DiagnosticsView() }
                .tabItem { Label("You", systemImage: "person.crop.circle") }
                .tag("you")
        }
        .tint(LevelUpStill.cognac)
        // Still currently has one intentional light palette. Avoid combining
        // its fixed linen surfaces with dark-mode semantic text colors.
        .preferredColorScheme(.light)
        .onChange(of: selectedTab) { _, value in
            DiagnosticLog.shared.record("tab_changed", category: "navigation", detail: "tab=\(value)")
        }
    }
}

private struct TodayView: View {
    @ObservedObject var model: LevelUpModel
    @State private var showWorkout = false

    var body: some View {
        ZStack {
            LevelUpStill.background.ignoresSafeArea()
            content
        }
        .navigationTitle("Today")
        .navigationDestination(isPresented: $showWorkout) {
            if let workout = model.workout, let session = model.activeSession {
                ActiveWorkoutView(model: model, workout: workout, session: session)
            }
        }
        .task { if model.workout == nil { await model.load() } }
        .refreshable { await model.load() }
        .alert("Level Up needs attention", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(model.errorMessage ?? "") }
    }

    @ViewBuilder private var content: some View {
        if model.isLoading && model.workout == nil {
            ProgressView("Preparing today's session…")
                .tint(LevelUpStill.cognac)
                .foregroundStyle(LevelUpStill.secondaryInk)
        } else if let workout = model.workout {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    readinessCard(workout)
                    flareControls
                    workoutCard(workout)
                }
                .padding(18)
            }
        } else {
            ContentUnavailableView(
                "Workout unavailable",
                systemImage: "figure.strengthtraining.traditional",
                description: Text("Pull to refresh when you're back online.")
            )
        }
    }

    private func readinessCard(_ workout: TodayWorkout) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Readiness").font(.caption.weight(.medium)).foregroundStyle(LevelUpStill.onPetrolSecondary)
            HStack(alignment: .firstTextBaseline) {
                Text(workout.readiness.band.label)
                    .font(.system(size: 28, design: .serif))
                    .foregroundStyle(LevelUpStill.camel)
                Spacer()
                Text(workout.readiness.localDay)
                    .font(.caption)
                    .foregroundStyle(LevelUpStill.onPetrolSecondary)
            }
            Text(readinessExplanation(workout.readiness))
                .font(.subheadline)
                .foregroundStyle(LevelUpStill.onPetrol)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LevelUpStill.petrol.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var flareControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("How are your joints?").font(.headline).foregroundStyle(LevelUpStill.ink)
            Toggle("Knee is flaring", isOn: $model.kneeFlare)
            Toggle("Lower back is flaring", isOn: $model.lumbarFlare)
            Button("Update workout") { Task { await model.refreshForFlares() } }
                .buttonStyle(.bordered)
                .tint(LevelUpStill.cognac)
                .accessibilityHint("Recalculates exercise choices using the joint settings above")
        }
        .levelUpCard()
    }

    private func workoutCard(_ workout: TodayWorkout) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(workout.dayName)
                    .font(.system(size: 28, design: .serif))
                    .foregroundStyle(LevelUpStill.ink)
                Text("\(workout.entries.reduce(0) { $0 + $1.targetSets }) working sets")
                    .font(.subheadline)
                    .foregroundStyle(LevelUpStill.mutedInk)
            }

            ForEach(workout.entries) { entry in
                HStack(spacing: 12) {
                    Image(systemName: exerciseSymbol(entry.exercise.modality))
                        .font(.title3)
                        .foregroundStyle(LevelUpStill.cognacDeep)
                        .frame(width: 42, height: 42)
                        .background(LevelUpStill.cognacSoft)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(entry.exercise.label).font(.body.weight(.medium)).foregroundStyle(LevelUpStill.ink)
                        Text(prescription(entry)).font(.caption).foregroundStyle(LevelUpStill.mutedInk)
                        if let substitutedFor = entry.substitutedFor {
                            Text("Instead of \(substitutedFor)").font(.caption).foregroundStyle(LevelUpStill.cognacDeep)
                        }
                    }
                    Spacer()
                    if entry.exercise.catalogKey != nil {
                        Text("Rankable").font(.caption2.weight(.semibold)).foregroundStyle(LevelUpStill.success)
                    }
                }
            }

            Button {
                if model.activeSession != nil {
                    showWorkout = true
                } else {
                    Task {
                        await model.startWorkout()
                        if model.activeSession != nil { showWorkout = true }
                    }
                }
            } label: {
                HStack {
                    if model.isStarting { ProgressView().tint(.white) }
                    Text(model.activeSession == nil ? "Start workout" : "Resume workout")
                    if !model.isStarting { Image(systemName: "arrow.right") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(LevelUpStill.cognac)
            .clipShape(Capsule())
            .disabled(model.isStarting)
        }
        .levelUpCard()
    }

    private func readinessExplanation(_ snapshot: ReadinessSnapshot) -> String {
        if snapshot.reasonCodes?.contains("synthetic_neutral_v1") == true {
            return "No fresh readiness signal yet, so the original session is preserved. Missing data is neutral."
        }
        return "Your recommendation is versioned, explainable, and always yours to override."
    }

    private func prescription(_ entry: PreparedWorkoutEntry) -> String {
        if let seconds = entry.targetDurationSec { return "\(entry.targetSets) × \(seconds)s · \(entry.restSec)s rest" }
        return "\(entry.targetSets) × \(entry.targetReps ?? 0) · \(entry.restSec)s rest"
    }

    private func exerciseSymbol(_ modality: String) -> String {
        modality == "duration" ? "timer" : modality == "bodyweight" ? "figure.core.training" : "dumbbell"
    }
}

private struct PlaceholderSection: View {
    let title: String
    let message: String
    let symbol: String

    var body: some View {
        NavigationStack {
            ZStack {
                LevelUpStill.background.ignoresSafeArea()
                ContentUnavailableView(title, systemImage: symbol, description: Text(message))
                    .foregroundStyle(LevelUpStill.secondaryInk)
            }
            .navigationTitle(title)
        }
    }
}

extension View {
    func levelUpCard() -> some View {
        padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LevelUpStill.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(LevelUpStill.border.opacity(0.5), lineWidth: 0.5))
    }
}
