import Foundation
import Testing
@testable import LevelUpFeature

@Test func decodesCanonicalTodayBundle() throws {
    let data = Data(#"""
    {
      "programDayId":"day-1","dayName":"A — Pull & press",
      "entries":[{
        "entryId":"entry-1","order":0,
        "exercise":{"id":"exercise-1","key":"bench_press","label":"Bench press","modality":"load","catalogKey":"bench_press","defaultRestSec":150,"jointLoad":["shoulder"]},
        "substitutedFor":null,"targetSets":3,"targetReps":8,"targetLoadKg":null,"targetDurationSec":null,"restSec":150,
        "lastLoadKg":82.5,"lastReps":8,"lastDurationSec":null,"lastIsBodyweight":false
      }],
      "profile":{"bodyweightKg":88.4,"unit":"lb","microPlates":false},
      "readiness":{"localDay":"2026-08-20","engineVersion":"v1","ruleSetVersion":"v1","inputs":{"synthetic":true},"formSignal":null,"band":"full","reasonCodes":["synthetic_neutral_v1"]}
    }
    """#.utf8)

    let workout = try JSONDecoder().decode(TodayWorkout.self, from: data)
    #expect(workout.dayName == "A — Pull & press")
    #expect(workout.entries.first?.exercise.catalogKey == "bench_press")
    #expect(workout.readiness.band == .full)
}

@Test func setCommandPreservesExerciseIdentityAndBodyweightMode() {
    let exercise = PreparedExercise(id: "exercise-1", key: "weighted_pullup", label: "Weighted pull-up", modality: "bodyweight", catalogKey: "weighted_pullup", defaultRestSec: 120, jointLoad: [])
    let entry = PreparedWorkoutEntry(entryId: "entry-1", order: 0, exercise: exercise, substitutedFor: nil, targetSets: 3, targetReps: 6, targetLoadKg: nil, targetDurationSec: nil, restSec: 120, lastLoadKg: 10, lastReps: 6, lastDurationSec: nil, lastIsBodyweight: true)
    let command = LogSetCommand(sessionId: "session-1", entry: entry, setIndex: 0, reps: 6, loadKg: 12.5, durationSec: nil, bodyweightKg: 88, sourceId: "set-1")

    #expect(command.exerciseId == "exercise-1")
    #expect(command.catalogKey == "weighted_pullup")
    #expect(command.isBodyweight)
}

@Test func demoModeAppliesFlaresWithoutAuthentication() async throws {
    let demo = DemoWorkoutDataSource()
    let original = try await demo.today(kneeFlare: false, lumbarFlare: false)
    let adjusted = try await demo.today(kneeFlare: true, lumbarFlare: true)

    #expect(original.entries[0].exercise.key == "box_jump")
    #expect(original.entries[1].exercise.key == "trap_bar_deadlift")
    #expect(adjusted.entries[0].exercise.key == "pogo_hops")
    #expect(adjusted.entries[1].exercise.key == "hip_thrust")
    #expect(adjusted.entries[0].substitutedFor == "Box jump")
}

@MainActor
@Test func diagnosticErrorsKeepCodesButExcludeDescriptions() throws {
    let diagnostics = DiagnosticLog.shared
    diagnostics.clear()
    let error = NSError(
        domain: "LevelUpFeatureTests",
        code: 42,
        userInfo: [NSLocalizedDescriptionKey: "private health detail must not appear"]
    )

    diagnostics.record(error: error, operation: "sample_failed", category: "testing")
    let report = try String(contentsOf: diagnostics.makeShareableReport(), encoding: .utf8)

    #expect(report.contains("domain=LevelUpFeatureTests code=42"))
    #expect(!report.contains("private health detail must not appear"))
}

@MainActor
@Test func workoutSessionCanStartLogAndComplete() async throws {
    let model = LevelUpModel(dataSource: DemoWorkoutDataSource())
    await model.load()
    await model.startWorkout()

    let entry = try #require(model.workout?.entries.first)
    let logged = await model.logSet(
        entry: entry,
        setIndex: 0,
        reps: entry.targetReps ?? 0,
        loadKg: entry.targetLoadKg ?? 0,
        durationSec: entry.targetDurationSec
    )
    let completed = await model.completeWorkout(sessionRpe: 7)

    #expect(model.activeSession != nil)
    #expect(logged != nil)
    #expect(completed != nil)
}

@Test func demoExercisesHaveSpecificGuidance() async throws {
    let workout = try await DemoWorkoutDataSource().today(kneeFlare: false, lumbarFlare: false)
    for entry in workout.entries {
        let guide = ExerciseGuide.forExercise(entry.exercise)
        #expect(guide.setup.count >= 1)
        #expect(guide.execution.count >= 2)
        #expect(guide.mistakes.count >= 2)
        #expect(!guide.rangeOfMotion.isEmpty)
    }
}

@Test func aiLoadsArePlateLoadableAndNeverShowConversionNoise() async throws {
    let workout = try await DemoWorkoutDataSource().today(kneeFlare: false, lumbarFlare: false)
    let loadedEntries = workout.entries.filter { $0.exercise.usesLoad }

    #expect(!loadedEntries.isEmpty)
    for entry in loadedEntries {
        let prescription = WorkoutLoad.prescription(for: entry, profile: workout.profile)
        #expect(prescription.source == .aiPlan)
        #expect(prescription.value.truncatingRemainder(dividingBy: 5) == 0)
        #expect(!WorkoutLoad.format(prescription.value, unit: "lb").contains(".32"))
    }
    #expect(loadedEntries.first(where: { $0.exercise.key == "bench_press" }).map {
        WorkoutLoad.prescription(for: $0, profile: workout.profile).value
    } == 135)
}

@Test func realPlanFallbacksSnapHistoryAndNeverSeedZero() {
    let profile = WorkoutProfile(bodyweightKg: 86, unit: "lb", microPlates: false)
    let exercise = PreparedExercise(id: "exercise-1", key: "bench_press", label: "Bench press", modality: "load", catalogKey: "bench_press", defaultRestSec: 150, jointLoad: [])
    let historyEntry = PreparedWorkoutEntry(entryId: "history", order: 0, exercise: exercise, substitutedFor: nil, targetSets: 3, targetReps: 8, targetLoadKg: nil, targetDurationSec: nil, restSec: 150, lastLoadKg: 70, lastReps: 8, lastDurationSec: nil, lastIsBodyweight: false)
    let newEntry = PreparedWorkoutEntry(entryId: "new", order: 0, exercise: exercise, substitutedFor: nil, targetSets: 3, targetReps: 8, targetLoadKg: nil, targetDurationSec: nil, restSec: 150, lastLoadKg: nil, lastReps: nil, lastDurationSec: nil, lastIsBodyweight: false)

    #expect(WorkoutLoad.prescription(for: historyEntry, profile: profile).value == 155)
    #expect(WorkoutLoad.prescription(for: historyEntry, profile: profile).source == .previousPerformance)
    #expect(WorkoutLoad.prescription(for: newEntry, profile: profile).value == 45)
    #expect(WorkoutLoad.prescription(for: newEntry, profile: profile).source == .equipmentStartingPoint)
}
