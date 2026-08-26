import Foundation

public enum ReadinessBand: String, Codable, Sendable {
    case full, adjust, recover

    public var label: String {
        switch self {
        case .full: "Full session"
        case .adjust: "Adjusted session"
        case .recover: "Recovery session"
        }
    }
}

public struct ReadinessSnapshot: Codable, Sendable {
    public let localDay: String
    public let engineVersion: String
    public let ruleSetVersion: String
    public let band: ReadinessBand
    public let reasonCodes: [String]?
}

public struct WorkoutProfile: Codable, Sendable {
    public let bodyweightKg: Double?
    public let unit: String
    public let microPlates: Bool
}

public struct PreparedExercise: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let key: String
    public let label: String
    public let modality: String
    public let catalogKey: String?
    public let defaultRestSec: Int
    public let jointLoad: [String]
}

extension PreparedExercise {
    var usesLoad: Bool { modality == "load" || modality == "load_duration" }
    var usesDuration: Bool { modality == "duration" || modality == "load_duration" }
    var isBodyweight: Bool { modality == "bodyweight" }
}

public struct PreparedWorkoutEntry: Codable, Identifiable, Hashable, Sendable {
    public var id: String { entryId }
    public let entryId: String
    public let order: Int
    public let exercise: PreparedExercise
    public let substitutedFor: String?
    public let targetSets: Int
    public let targetReps: Int?
    public let targetLoadKg: Double?
    public let targetDurationSec: Int?
    public let restSec: Int
    public let lastLoadKg: Double?
    public let lastReps: Int?
    public let lastDurationSec: Int?
    public let lastIsBodyweight: Bool
}

public struct TodayWorkout: Codable, Sendable {
    public let programDayId: String
    public let dayName: String
    public let entries: [PreparedWorkoutEntry]
    public let profile: WorkoutProfile
    public let readiness: ReadinessSnapshot
}

public struct StartedWorkout: Codable, Sendable {
    public let id: String
    public let startedAt: String
    public let duplicate: Bool
}

public struct LoggedSet: Codable, Sendable {
    public let id: String
    public let rank: Double?
    public let rankLetter: String?
    public let balance: Double?
    public let balanceLabel: String?
    public let suppressedRankReason: String?
    public let isPr: Bool
    public let e1rm: Double?
    public let duplicate: Bool
}

public struct CompletedWorkout: Codable, Sendable {
    public let completedAt: String
}

public struct StartWorkoutCommand: Codable, Sendable {
    public let programDayId: String?
    public let kneeFlare: Bool
    public let lumbarFlare: Bool
    public let sourceId: String?

    public init(programDayId: String?, kneeFlare: Bool, lumbarFlare: Bool, sourceId: String? = nil) {
        self.programDayId = programDayId
        self.kneeFlare = kneeFlare
        self.lumbarFlare = lumbarFlare
        self.sourceId = sourceId
    }
}

public struct LogSetCommand: Codable, Sendable {
    public let sessionId: String
    public let exerciseId: String
    public let exerciseKey: String
    public let catalogKey: String?
    public let setIndex: Int
    public let reps: Int
    public let loadKg: Double
    public let durationSec: Int?
    public let isBodyweight: Bool
    public let bodyweightKg: Double?
    public let sourceId: String?

    public init(sessionId: String, entry: PreparedWorkoutEntry, setIndex: Int, reps: Int, loadKg: Double, durationSec: Int?, bodyweightKg: Double?, sourceId: String? = nil) {
        self.sessionId = sessionId
        self.exerciseId = entry.exercise.id
        self.exerciseKey = entry.exercise.key
        self.catalogKey = entry.exercise.catalogKey
        self.setIndex = setIndex
        self.reps = reps
        self.loadKg = loadKg
        self.durationSec = durationSec
        self.isBodyweight = entry.exercise.isBodyweight
        self.bodyweightKg = bodyweightKg
        self.sourceId = sourceId
    }
}

public struct CompleteWorkoutCommand: Codable, Sendable {
    public let sessionId: String
    public let sessionRpe: Double?

    public init(sessionId: String, sessionRpe: Double? = nil) {
        self.sessionId = sessionId
        self.sessionRpe = sessionRpe
    }
}
