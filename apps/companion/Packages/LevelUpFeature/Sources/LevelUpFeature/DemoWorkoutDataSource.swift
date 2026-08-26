import Foundation

/// DEBUG-build data for exercising the native app without credentials or
/// writing sample workouts into the user's graph.
public struct DemoWorkoutDataSource: WorkoutDataSource, Sendable {
    public init() {}

    public func today(kneeFlare: Bool, lumbarFlare: Bool) async throws -> TodayWorkout {
        TodayWorkout(
            programDayId: "demo-day-a",
            dayName: "A — Pull & press",
            entries: [
                entry(0, exercise: kneeFlare ? pogoHops : boxJump, substitutedFor: kneeFlare ? "Box jump" : nil, sets: kneeFlare ? 3 : 4, reps: kneeFlare ? 10 : 3, rest: kneeFlare ? 60 : 90),
                entry(1, exercise: lumbarFlare ? hipThrust : trapBarDeadlift, substitutedFor: lumbarFlare ? "Trap-bar deadlift" : nil, sets: 4, reps: 5, load: kilograms(fromPounds: lumbarFlare ? 185 : 225), rest: lumbarFlare ? 90 : 180, lastLoad: kilograms(fromPounds: lumbarFlare ? 175 : 215), lastReps: 5),
                entry(2, exercise: benchPress, sets: 3, reps: 8, load: kilograms(fromPounds: 135), rest: 150, lastLoad: kilograms(fromPounds: 130), lastReps: 8),
                entry(3, exercise: kneeFlare ? hipThrust : splitSquat, substitutedFor: kneeFlare ? "Bulgarian split squat" : nil, sets: 3, reps: 8, load: kilograms(fromPounds: kneeFlare ? 185 : 50), rest: 90, lastLoad: kilograms(fromPounds: kneeFlare ? 175 : 45), lastReps: 8),
                entry(4, exercise: farmerCarry, sets: 3, load: kilograms(fromPounds: 70), duration: 45, rest: 90, lastLoad: kilograms(fromPounds: 65), lastDuration: 45),
                entry(5, exercise: plank, sets: 3, duration: 45, rest: 60, lastDuration: 40),
            ],
            profile: WorkoutProfile(bodyweightKg: 86, unit: "lb", microPlates: false),
            readiness: ReadinessSnapshot(
                localDay: Self.localDay,
                engineVersion: "demo-v1",
                ruleSetVersion: "demo-v1",
                band: .full,
                reasonCodes: ["synthetic_neutral_v1"]
            )
        )
    }

    public func start(_ command: StartWorkoutCommand) async throws -> StartedWorkout {
        StartedWorkout(id: command.sourceId ?? UUID().uuidString, startedAt: Date().ISO8601Format(), duplicate: false)
    }

    public func logSet(_ command: LogSetCommand) async throws -> LoggedSet {
        LoggedSet(
            id: command.sourceId ?? UUID().uuidString,
            rank: nil,
            rankLetter: nil,
            balance: nil,
            balanceLabel: nil,
            suppressedRankReason: "Testing mode uses sample data.",
            isPr: false,
            e1rm: nil,
            duplicate: false
        )
    }

    public func complete(_ command: CompleteWorkoutCommand) async throws -> CompletedWorkout {
        CompletedWorkout(completedAt: Date().ISO8601Format())
    }

    private static var localDay: String {
        let components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }
}

private extension DemoWorkoutDataSource {
    func entry(
        _ order: Int,
        exercise: PreparedExercise,
        substitutedFor: String? = nil,
        sets: Int,
        reps: Int? = nil,
        load: Double? = nil,
        duration: Int? = nil,
        rest: Int,
        lastLoad: Double? = nil,
        lastReps: Int? = nil,
        lastDuration: Int? = nil
    ) -> PreparedWorkoutEntry {
        PreparedWorkoutEntry(
            entryId: "demo-entry-\(order)",
            order: order,
            exercise: exercise,
            substitutedFor: substitutedFor,
            targetSets: sets,
            targetReps: reps,
            targetLoadKg: load,
            targetDurationSec: duration,
            restSec: rest,
            lastLoadKg: lastLoad,
            lastReps: lastReps,
            lastDurationSec: lastDuration,
            lastIsBodyweight: exercise.modality == "bodyweight"
        )
    }

    func kilograms(fromPounds pounds: Double) -> Double {
        pounds / WorkoutLoad.poundsPerKilogram
    }

    var boxJump: PreparedExercise { exercise("box_jump", "Box jump", "bodyweight", nil, 90, ["knee"]) }
    var pogoHops: PreparedExercise { exercise("pogo_hops", "Pogo hops", "bodyweight", nil, 60, []) }
    var trapBarDeadlift: PreparedExercise { exercise("trap_bar_deadlift", "Trap-bar deadlift", "load", "trap_bar_deadlift", 180, ["lumbar"]) }
    var hipThrust: PreparedExercise { exercise("hip_thrust", "Hip thrust", "load", "hip_thrust", 90, []) }
    var benchPress: PreparedExercise { exercise("bench_press", "Bench press", "load", "bench_press", 150, ["shoulder"]) }
    var splitSquat: PreparedExercise { exercise("bulgarian_split_squat", "Bulgarian split squat", "load", "bulgarian_split_squat", 90, ["knee"]) }
    var farmerCarry: PreparedExercise { exercise("farmer_carry", "Farmer carry", "load_duration", nil, 90, ["lumbar"]) }
    var plank: PreparedExercise { exercise("plank", "Plank", "duration", nil, 60, []) }

    func exercise(_ key: String, _ label: String, _ modality: String, _ catalogKey: String?, _ rest: Int, _ jointLoad: [String]) -> PreparedExercise {
        PreparedExercise(id: "demo-\(key)", key: key, label: label, modality: modality, catalogKey: catalogKey, defaultRestSec: rest, jointLoad: jointLoad)
    }
}
