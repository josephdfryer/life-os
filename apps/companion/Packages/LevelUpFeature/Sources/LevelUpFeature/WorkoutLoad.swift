import Foundation

enum WorkoutLoadSource: Equatable {
    case aiPlan
    case previousPerformance
    case equipmentStartingPoint

    var label: String {
        switch self {
        case .aiPlan: "AI plan recommendation"
        case .previousPerformance: "Previous working load"
        case .equipmentStartingPoint: "Starting point — adjust after your warm-up"
        }
    }
}

struct WorkoutLoadPrescription: Equatable {
    let value: Double
    let source: WorkoutLoadSource
}

enum WorkoutLoad {
    static let poundsPerKilogram = 2.204_622_621_8

    static func step(for profile: WorkoutProfile) -> Double {
        if profile.unit == "lb" { return profile.microPlates ? 2.5 : 5 }
        return profile.microPlates ? 1.25 : 2.5
    }

    static func displayValue(fromKilograms kilograms: Double, profile: WorkoutProfile) -> Double {
        let converted = profile.unit == "lb" ? kilograms * poundsPerKilogram : kilograms
        return snap(converted, to: step(for: profile))
    }

    static func kilograms(fromDisplayValue value: Double, profile: WorkoutProfile) -> Double {
        profile.unit == "lb" ? value / poundsPerKilogram : value
    }

    static func prescription(for entry: PreparedWorkoutEntry, profile: WorkoutProfile) -> WorkoutLoadPrescription {
        if let target = entry.targetLoadKg, target > 0 {
            return WorkoutLoadPrescription(value: displayValue(fromKilograms: target, profile: profile), source: .aiPlan)
        }
        if let previous = entry.lastLoadKg, previous > 0 {
            return WorkoutLoadPrescription(value: displayValue(fromKilograms: previous, profile: profile), source: .previousPerformance)
        }
        let emptyBar = profile.unit == "lb" ? 45.0 : 20.0
        return WorkoutLoadPrescription(value: snap(emptyBar, to: step(for: profile)), source: .equipmentStartingPoint)
    }

    static func format(_ value: Double, unit: String) -> String {
        let rounded = (value * 100).rounded() / 100
        let number = rounded.formatted(.number.precision(.fractionLength(0...2)))
        return "\(number) \(unit)"
    }

    private static func snap(_ value: Double, to step: Double) -> Double {
        guard step > 0 else { return value }
        return ((value / step).rounded() * step * 100).rounded() / 100
    }
}
