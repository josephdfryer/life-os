import Foundation

@MainActor
final class LevelUpModel: ObservableObject {
    @Published private(set) var workout: TodayWorkout?
    @Published private(set) var activeSession: StartedWorkout?
    @Published private(set) var isLoading = false
    @Published private(set) var isStarting = false
    @Published private(set) var isLoggingSet = false
    @Published private(set) var isCompleting = false
    @Published var kneeFlare = false
    @Published var lumbarFlare = false
    @Published var errorMessage: String?

    private let dataSource: any WorkoutDataSource
    private let diagnostics = DiagnosticLog.shared

    init(dataSource: any WorkoutDataSource) {
        self.dataSource = dataSource
        diagnostics.record("model_created", category: "lifecycle")
    }

    func load() async {
        let startedAt = Date()
        diagnostics.record("today_load_started", category: "loading")
        isLoading = true
        defer { isLoading = false }
        do {
            workout = try await dataSource.today(kneeFlare: kneeFlare, lumbarFlare: lumbarFlare)
            errorMessage = nil
            diagnostics.record(
                "today_load_succeeded",
                category: "loading",
                detail: "exerciseCount=\(workout?.entries.count ?? 0)",
                duration: Date().timeIntervalSince(startedAt)
            )
        } catch {
            errorMessage = "Today's workout could not be loaded. Check your connection and try again."
            diagnostics.record(
                error: error,
                operation: "today_load_failed",
                category: "loading",
                duration: Date().timeIntervalSince(startedAt)
            )
        }
    }

    func refreshForFlares() async {
        diagnostics.record("substitutions_requested", category: "workout")
        await load()
    }

    func startWorkout() async {
        guard let workout else {
            diagnostics.record("start_blocked_no_workout", level: .warning, category: "workout")
            return
        }
        let startedAt = Date()
        diagnostics.record("start_requested", category: "workout")
        isStarting = true
        defer { isStarting = false }
        do {
            activeSession = try await dataSource.start(StartWorkoutCommand(
                programDayId: workout.programDayId,
                kneeFlare: kneeFlare,
                lumbarFlare: lumbarFlare,
                sourceId: UUID().uuidString
            ))
            errorMessage = nil
            diagnostics.record(
                "start_succeeded",
                category: "workout",
                duration: Date().timeIntervalSince(startedAt)
            )
        } catch {
            errorMessage = "The workout could not be started. Nothing was lost."
            diagnostics.record(
                error: error,
                operation: "start_failed",
                category: "workout",
                duration: Date().timeIntervalSince(startedAt)
            )
        }
    }

    func logSet(
        entry: PreparedWorkoutEntry,
        setIndex: Int,
        reps: Int,
        loadKg: Double,
        durationSec: Int?
    ) async -> LoggedSet? {
        guard let session = activeSession, let workout else {
            diagnostics.record("set_blocked_no_session", level: .warning, category: "workout")
            return nil
        }
        let startedAt = Date()
        diagnostics.record("set_log_started", category: "workout", detail: "setIndex=\(setIndex)")
        isLoggingSet = true
        defer { isLoggingSet = false }
        do {
            let result = try await dataSource.logSet(LogSetCommand(
                sessionId: session.id,
                entry: entry,
                setIndex: setIndex,
                reps: reps,
                loadKg: loadKg,
                durationSec: durationSec,
                bodyweightKg: workout.profile.bodyweightKg,
                sourceId: UUID().uuidString
            ))
            errorMessage = nil
            diagnostics.record(
                "set_log_succeeded",
                category: "workout",
                detail: "setIndex=\(setIndex) pr=\(result.isPr)",
                duration: Date().timeIntervalSince(startedAt)
            )
            return result
        } catch {
            errorMessage = "That set could not be saved. Your entries are still on screen—try again."
            diagnostics.record(
                error: error,
                operation: "set_log_failed",
                category: "workout",
                duration: Date().timeIntervalSince(startedAt)
            )
            return nil
        }
    }

    func completeWorkout(sessionRpe: Double?) async -> CompletedWorkout? {
        guard let session = activeSession else {
            diagnostics.record("complete_blocked_no_session", level: .warning, category: "workout")
            return nil
        }
        let startedAt = Date()
        diagnostics.record("complete_started", category: "workout")
        isCompleting = true
        defer { isCompleting = false }
        do {
            let result = try await dataSource.complete(CompleteWorkoutCommand(sessionId: session.id, sessionRpe: sessionRpe))
            errorMessage = nil
            diagnostics.record("complete_succeeded", category: "workout", duration: Date().timeIntervalSince(startedAt))
            return result
        } catch {
            errorMessage = "The workout could not be completed. Your sets are safe—try again."
            diagnostics.record(
                error: error,
                operation: "complete_failed",
                category: "workout",
                duration: Date().timeIntervalSince(startedAt)
            )
            return nil
        }
    }

    func closeCompletedWorkout() {
        activeSession = nil
        diagnostics.record("session_closed", category: "workout")
    }
}
