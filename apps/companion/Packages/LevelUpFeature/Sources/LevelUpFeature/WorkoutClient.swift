import Foundation
import LifeOSCompanionCore

public protocol WorkoutDataSource: Sendable {
    func today(kneeFlare: Bool, lumbarFlare: Bool) async throws -> TodayWorkout
    func start(_ command: StartWorkoutCommand) async throws -> StartedWorkout
    func logSet(_ command: LogSetCommand) async throws -> LoggedSet
    func complete(_ command: CompleteWorkoutCommand) async throws -> CompletedWorkout
}

public struct WorkoutClient: WorkoutDataSource, Sendable {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func today(kneeFlare: Bool, lumbarFlare: Bool) async throws -> TodayWorkout {
        try await api.get(
            path: "v1/device/workout/today",
            queryItems: [
                URLQueryItem(name: "knee", value: kneeFlare ? "1" : "0"),
                URLQueryItem(name: "lumbar", value: lumbarFlare ? "1" : "0"),
            ]
        )
    }

    public func start(_ command: StartWorkoutCommand) async throws -> StartedWorkout {
        try await api.post(path: "v1/device/workout/sessions", body: command)
    }

    public func logSet(_ command: LogSetCommand) async throws -> LoggedSet {
        try await api.post(path: "v1/device/workout/sessions/\(command.sessionId)/sets", body: command)
    }

    public func complete(_ command: CompleteWorkoutCommand) async throws -> CompletedWorkout {
        try await api.post(path: "v1/device/workout/sessions/\(command.sessionId)/complete", body: command)
    }
}
