import Combine
import SwiftUI

struct ActiveWorkoutView: View {
    @ObservedObject var model: LevelUpModel
    let workout: TodayWorkout
    let session: StartedWorkout

    @Environment(\.dismiss) private var dismiss
    @State private var exerciseIndex = 0
    @State private var completedSets: [String: Int] = [:]
    @State private var reps = 0
    @State private var load = 0.0
    @State private var durationSeconds = 0
    @State private var restEndsAt: Date?
    @State private var restRemaining = 0
    @State private var lastResult: LoggedSet?
    @State private var allSetsComplete = false
    @State private var sessionRpe = 7.0
    @State private var completedAt: String?
    @State private var exerciseDrafts: [String: ExerciseDraft] = [:]
    @State private var detailEntry: PreparedWorkoutEntry?

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
#if os(iOS)
        content
            .navigationBarBackButtonHidden(completedAt != nil)
            .navigationTitle(completedAt == nil ? "Workout" : "Complete")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
            .toolbar {
                if completedAt == nil {
                    ToolbarItem(placement: .topBarTrailing) { laterButton }
                }
            }
#else
        content
            .navigationTitle(completedAt == nil ? "Workout" : "Complete")
            .toolbar {
                if completedAt == nil { ToolbarItem { laterButton } }
            }
#endif
    }

    private var content: some View {
        ZStack {
            LevelUpStill.background.ignoresSafeArea()
            if completedAt == nil { sessionBody } else { completionBody }
        }
        .onAppear {
            configureInputs(for: currentEntry)
            DiagnosticLog.shared.record("session_screen_opened", category: "navigation")
        }
        .onReceive(timer) { _ in updateRestCountdown() }
        .sheet(item: $detailEntry) { entry in
            ExerciseDetailView(entry: entry)
        }
        .alert("Level Up needs attention", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(model.errorMessage ?? "") }
    }

    private var laterButton: some View {
        Button("Later") {
            DiagnosticLog.shared.record("session_left_open", category: "workout")
            dismiss()
        }
    }

    private var sessionBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                sessionHeader
                if restRemaining > 0 { restCard }
                if allSetsComplete { finishCard } else { exerciseCard }
                workoutQueue
            }
            .padding(18)
        }
    }

    private var sessionHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(workout.dayName).font(.system(size: 24, design: .serif)).foregroundStyle(LevelUpStill.ink)
                    Text(allSetsComplete ? "All sets logged" : "Exercise \(exerciseIndex + 1) of \(workout.entries.count)")
                        .font(.subheadline).foregroundStyle(LevelUpStill.mutedInk)
                }
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(elapsedString(at: context.date))
                        .font(.body.monospacedDigit().weight(.semibold))
                        .foregroundStyle(LevelUpStill.cognacDeep)
                }
            }
            ProgressView(value: progress)
                .tint(LevelUpStill.cognac)
        }
        .levelUpCard()
    }

    private var exerciseCard: some View {
        let entry = currentEntry
        let completed = completedSets[entry.id, default: 0]
        return VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline) {
                    Text(entry.exercise.label)
                        .font(.system(size: 34, design: .serif))
                        .foregroundStyle(LevelUpStill.ink)
                    Spacer()
                    Button {
                        showGuide(for: entry)
                    } label: {
                        Image(systemName: "info.circle")
                            .font(.title2)
                            .foregroundStyle(LevelUpStill.cognacDeep)
                    }
                    .accessibilityLabel("How to do \(entry.exercise.label)")
                }
                Text(completed >= entry.targetSets ? "All \(entry.targetSets) planned sets complete" : "Set \(completed + 1) of \(entry.targetSets) · \(entry.restSec)s rest")
                    .font(.subheadline)
                    .foregroundStyle(LevelUpStill.mutedInk)
            }

            Button {
                showGuide(for: entry)
            } label: {
                Label("How to do this exercise", systemImage: "figure.strengthtraining.traditional")
            }
            .buttonStyle(.bordered)
            .tint(LevelUpStill.cognacDeep)

            HStack(spacing: 8) {
                ForEach(0..<entry.targetSets, id: \.self) { index in
                    Image(systemName: index < completed ? "checkmark.circle.fill" : index == completed ? "circle.inset.filled" : "circle")
                        .foregroundStyle(index <= completed ? LevelUpStill.cognac : LevelUpStill.border)
                }
            }

            if entry.exercise.usesDuration {
                valueStepper(title: "Duration", value: "\(durationSeconds) sec") {
                    Stepper("Duration", value: $durationSeconds, in: 5...600, step: 5).labelsHidden()
                }
            } else {
                valueStepper(title: "Reps", value: "\(reps)") {
                    Stepper("Reps", value: $reps, in: 1...100).labelsHidden()
                }
            }
            if entry.exercise.usesLoad {
                valueStepper(title: entry.exercise.key == "farmer_carry" ? "Load per hand" : "Load", value: formattedLoad) {
                    Stepper("Load", value: $load, in: 0...1_500, step: loadStep).labelsHidden()
                }
                Label(loadRecommendationLabel(for: entry), systemImage: "sparkles")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(LevelUpStill.cognacDeep)
            }

            if let lastResult {
                resultBanner(lastResult)
            }

            Button {
                Task { await logCurrentSet() }
            } label: {
                HStack {
                    if model.isLoggingSet { ProgressView().tint(.white) }
                    Text(model.isLoggingSet ? "Saving set…" : completed >= entry.targetSets ? "Exercise complete" : "Complete set")
                    if !model.isLoggingSet { Image(systemName: "checkmark") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(LevelUpStill.cognac)
            .clipShape(Capsule())
            .disabled(model.isLoggingSet || restRemaining > 0 || completed >= entry.targetSets)
        }
        .levelUpCard()
    }

    private var restCard: some View {
        HStack(spacing: 16) {
            Image(systemName: "timer").font(.title2).foregroundStyle(LevelUpStill.camel)
            VStack(alignment: .leading, spacing: 2) {
                Text("Rest").font(.caption.weight(.semibold)).foregroundStyle(LevelUpStill.onPetrolSecondary)
                Text(clockString(restRemaining)).font(.system(size: 32, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(LevelUpStill.onPetrol)
            }
            Spacer()
            Button("Skip") { restEndsAt = nil; restRemaining = 0 }
                .buttonStyle(.bordered)
                .tint(LevelUpStill.camel)
        }
        .padding(18)
        .background(LevelUpStill.petrol)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var finishCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("Every set is logged", systemImage: "checkmark.seal.fill")
                .font(.title3.weight(.semibold)).foregroundStyle(LevelUpStill.success)
            Text("How hard did the whole session feel?").font(.headline).foregroundStyle(LevelUpStill.ink)
            valueStepper(title: "Session effort", value: "\(Int(sessionRpe)) / 10") {
                Stepper("Session effort", value: $sessionRpe, in: 1...10, step: 1).labelsHidden()
            }
            Button {
                Task {
                    if let result = await model.completeWorkout(sessionRpe: sessionRpe) {
                        completedAt = result.completedAt
                    }
                }
            } label: {
                HStack {
                    if model.isCompleting { ProgressView().tint(.white) }
                    Text(model.isCompleting ? "Finishing…" : "Finish workout")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(LevelUpStill.success)
            .clipShape(Capsule())
            .disabled(model.isCompleting)
        }
        .levelUpCard()
    }

    private var completionBody: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "checkmark.circle.fill").font(.system(size: 72)).foregroundStyle(LevelUpStill.success)
            Text("Workout complete").font(.system(size: 36, design: .serif)).foregroundStyle(LevelUpStill.ink)
            Text("You logged \(totalSetCount) working sets. The session is ready for your Journey.")
                .multilineTextAlignment(.center).foregroundStyle(LevelUpStill.secondaryInk)
            Button("Done") {
                model.closeCompletedWorkout()
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .tint(LevelUpStill.cognac)
            .clipShape(Capsule())
            Spacer()
        }
        .padding(28)
    }

    private var workoutQueue: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Session").font(.headline).foregroundStyle(LevelUpStill.ink)
            ForEach(Array(workout.entries.enumerated()), id: \.element.id) { index, entry in
                HStack(spacing: 12) {
                    Button {
                        selectExercise(at: index)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: queueSymbol(for: index, entry: entry))
                                .foregroundStyle(queueColor(for: index, entry: entry))
                                .frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(entry.exercise.label).foregroundStyle(LevelUpStill.ink)
                                Text("\(completedSets[entry.id, default: 0]) of \(entry.targetSets) sets")
                                    .font(.caption).foregroundStyle(LevelUpStill.mutedInk)
                            }
                            Spacer()
                            if index == exerciseIndex && !allSetsComplete {
                                Text("Current").font(.caption2.weight(.semibold)).foregroundStyle(LevelUpStill.cognacDeep)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Switch to \(entry.exercise.label), \(completedSets[entry.id, default: 0]) of \(entry.targetSets) sets complete")

                    Button {
                        showGuide(for: entry)
                    } label: {
                        Image(systemName: "info.circle")
                            .foregroundStyle(LevelUpStill.cognacDeep)
                            .padding(8)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("How to do \(entry.exercise.label)")
                }
                .padding(.vertical, 4)
            }
        }
        .levelUpCard()
    }

    @ViewBuilder
    private func valueStepper<Control: View>(title: String, value: String, @ViewBuilder control: () -> Control) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).foregroundStyle(LevelUpStill.mutedInk)
                Text(value).font(.title2.monospacedDigit().weight(.semibold)).foregroundStyle(LevelUpStill.ink)
            }
            Spacer()
            control()
        }
        .padding(14)
        .background(LevelUpStill.surfaceSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func resultBanner(_ result: LoggedSet) -> some View {
        HStack {
            Image(systemName: result.isPr ? "trophy.fill" : "checkmark.circle.fill")
            Text(result.isPr ? "Personal record" : result.rankLetter.map { "Rank \($0)" } ?? "Last set saved")
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(result.isPr ? LevelUpStill.cognacDeep : LevelUpStill.success)
    }

    private var currentEntry: PreparedWorkoutEntry { workout.entries[exerciseIndex] }
    private var totalSetCount: Int { workout.entries.reduce(0) { $0 + $1.targetSets } }
    private var completedSetCount: Int { completedSets.values.reduce(0, +) }
    private var progress: Double { totalSetCount == 0 ? 0 : Double(completedSetCount) / Double(totalSetCount) }
    private var loadStep: Double { WorkoutLoad.step(for: workout.profile) }
    private var loadKg: Double { WorkoutLoad.kilograms(fromDisplayValue: load, profile: workout.profile) }
    private var formattedLoad: String { WorkoutLoad.format(load, unit: workout.profile.unit) }

    private func configureInputs(for entry: PreparedWorkoutEntry) {
        if let draft = exerciseDrafts[entry.id] {
            reps = draft.reps
            load = draft.load
            durationSeconds = draft.durationSeconds
            lastResult = nil
            return
        }
        reps = entry.targetReps ?? entry.lastReps ?? 1
        durationSeconds = entry.targetDurationSec ?? entry.lastDurationSec ?? 30
        load = WorkoutLoad.prescription(for: entry, profile: workout.profile).value
        lastResult = nil
    }

    private func loadRecommendationLabel(for entry: PreparedWorkoutEntry) -> String {
        let prescription = WorkoutLoad.prescription(for: entry, profile: workout.profile)
        let increment = WorkoutLoad.format(loadStep, unit: workout.profile.unit)
        return "\(prescription.source.label) · rounded to \(increment) increments"
    }

    private func saveCurrentDraft() {
        guard workout.entries.indices.contains(exerciseIndex) else { return }
        exerciseDrafts[currentEntry.id] = ExerciseDraft(reps: reps, load: load, durationSeconds: durationSeconds)
    }

    private func selectExercise(at index: Int) {
        guard workout.entries.indices.contains(index), index != exerciseIndex else { return }
        saveCurrentDraft()
        exerciseIndex = index
        configureInputs(for: currentEntry)
        allSetsComplete = completedSetCount >= totalSetCount
        DiagnosticLog.shared.record("exercise_switched", category: "workout", detail: "position=\(index + 1)")
    }

    private func showGuide(for entry: PreparedWorkoutEntry) {
        detailEntry = entry
        DiagnosticLog.shared.record("exercise_guide_opened", category: "navigation", detail: "exerciseKey=\(entry.exercise.key)")
    }

    private func logCurrentSet() async {
        let entry = currentEntry
        let setIndex = completedSets[entry.id, default: 0]
        guard let result = await model.logSet(
            entry: entry,
            setIndex: setIndex,
            reps: entry.exercise.usesDuration ? 0 : reps,
            loadKg: entry.exercise.usesLoad ? loadKg : 0,
            durationSec: entry.exercise.usesDuration ? durationSeconds : nil
        ) else { return }

        lastResult = result
        let newCount = setIndex + 1
        completedSets[entry.id] = newCount
        if newCount >= entry.targetSets {
            if completedSetCount >= totalSetCount {
                allSetsComplete = true
                restEndsAt = nil
                restRemaining = 0
            } else if let nextIndex = nextIncompleteExercise(after: exerciseIndex) {
                exerciseIndex = nextIndex
                configureInputs(for: currentEntry)
                beginRest(seconds: entry.restSec)
            }
        } else {
            beginRest(seconds: entry.restSec)
        }
    }

    private func beginRest(seconds: Int) {
        restEndsAt = Date().addingTimeInterval(TimeInterval(seconds))
        restRemaining = seconds
    }

    private func nextIncompleteExercise(after index: Int) -> Int? {
        let later = workout.entries.indices.filter { $0 > index }
        let earlier = workout.entries.indices.filter { $0 <= index }
        return (later + earlier).first { candidate in
            completedSets[workout.entries[candidate].id, default: 0] < workout.entries[candidate].targetSets
        }
    }

    private func updateRestCountdown() {
        guard let restEndsAt else { return }
        restRemaining = max(0, Int(ceil(restEndsAt.timeIntervalSinceNow)))
        if restRemaining == 0 { self.restEndsAt = nil }
    }

    private func elapsedString(at date: Date) -> String {
        guard let start = ISO8601DateFormatter().date(from: session.startedAt) else { return "0:00" }
        return clockString(max(0, Int(date.timeIntervalSince(start))))
    }

    private func clockString(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    private func queueSymbol(for index: Int, entry: PreparedWorkoutEntry) -> String {
        if completedSets[entry.id, default: 0] >= entry.targetSets { return "checkmark.circle.fill" }
        return index == exerciseIndex && !allSetsComplete ? "circle.inset.filled" : "circle"
    }

    private func queueColor(for index: Int, entry: PreparedWorkoutEntry) -> Color {
        if completedSets[entry.id, default: 0] >= entry.targetSets { return LevelUpStill.success }
        return index == exerciseIndex && !allSetsComplete ? LevelUpStill.cognac : LevelUpStill.border
    }
}

private struct ExerciseDraft {
    let reps: Int
    let load: Double
    let durationSeconds: Int
}
