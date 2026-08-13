import Foundation
import HealthKit
import LifeOSCompanionCore

@MainActor
final class HealthConnector {
    private let store = HKHealthStore()
    private weak var model: IOSCompanionModel?
    private let metricTypes: [(String, HKQuantityTypeIdentifier, HKStatisticsOptions)] = [
        ("step_count", .stepCount, .cumulativeSum), ("active_energy", .activeEnergyBurned, .cumulativeSum),
        ("resting_energy", .basalEnergyBurned, .cumulativeSum), ("apple_exercise_time", .appleExerciseTime, .cumulativeSum),
        ("flights_climbed", .flightsClimbed, .cumulativeSum), ("walking_running_distance", .distanceWalkingRunning, .cumulativeSum),
        ("resting_heart_rate", .restingHeartRate, .discreteAverage), ("heart_rate_variability", .heartRateVariabilitySDNN, .discreteAverage),
    ]
    init(model: IOSCompanionModel) { self.model = model }
    func authorizeAndStart() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw HealthError.unavailable }
        var read = Set<HKObjectType>(metricTypes.compactMap { HKObjectType.quantityType(forIdentifier: $0.1) })
        read.insert(HKObjectType.workoutType())
        try await store.requestAuthorization(toShare: [], read: read)
        for (_, identifier, _) in metricTypes { if let type = HKObjectType.quantityType(forIdentifier: identifier) { try? await store.enableBackgroundDelivery(for: type, frequency: .hourly); observe(type) } }
        try? await store.enableBackgroundDelivery(for: .workoutType(), frequency: .immediate); observe(.workoutType())
        await collectIncremental()
    }
    func collectIncremental() async {
        guard let model, let deviceId = await model.api?.deviceId else { return }
        let calendar = Calendar(identifier: .gregorian), now = Date(), start = calendar.startOfDay(for: calendar.date(byAdding: .day, value: -2, to: now)!)
        var days: [String: [JSONValue]] = [:]
        for (key, identifier, option) in metricTypes {
            guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else { continue }
            let values = await statistics(type: type, options: option, start: start, end: now)
            for (day, value) in values { days[day, default: []].append(.object(["key": .string(key), "value": .number(value)])) }
        }
        for (day, metrics) in days {
            let record = NormalizedRecord(type: "health.daily", fields: ["day": .string(day), "metrics": .array(metrics)])
            await model.enqueue(OutboxItem(deviceId: deviceId, source: .healthkit, sourceId: "daily-\(day)", observedAt: now, record: record))
        }
        await collectWorkouts(deviceId: deviceId, since: start)
    }
    private func observe(_ type: HKSampleType) { let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completion, _ in Task { @MainActor in await self?.collectIncremental(); completion() } }; store.execute(query) }
    private func statistics(type: HKQuantityType, options: HKStatisticsOptions, start: Date, end: Date) async -> [(String, Double)] { await withCheckedContinuation { continuation in
        var interval = DateComponents(); interval.day = 1; let query = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end), options: options, anchorDate: Calendar.current.startOfDay(for: start), intervalComponents: interval)
        query.initialResultsHandler = { _, results, _ in var output: [(String, Double)] = []; results?.enumerateStatistics(from: start, to: end) { stat, _ in let quantity = options.contains(.cumulativeSum) ? stat.sumQuantity() : stat.averageQuantity(); if let quantity { output.append((Self.dayString(for: stat.startDate), quantity.doubleValue(for: Self.unit(for: type.identifier)))) } }; continuation.resume(returning: output) }; store.execute(query)
    } }
    private func collectWorkouts(deviceId: String, since: Date) async { let descriptor = HKSampleQueryDescriptor(predicates: [.workout(HKQuery.predicateForSamples(withStart: since, end: Date()))], sortDescriptors: [SortDescriptor(\.startDate)]); guard let workouts = try? await descriptor.result(for: store) else { return }; for workout in workouts { let record = NormalizedRecord(type: "health.workout", fields: ["workoutType": .string(String(workout.workoutActivityType.rawValue)), "startedAt": .string(workout.startDate.ISO8601Format()), "endedAt": .string(workout.endDate.ISO8601Format()), "durationSeconds": .number(workout.duration), "energyKcal": workout.totalEnergyBurned.map { .number($0.doubleValue(for: .kilocalorie())) } ?? .null, "distanceMeters": workout.totalDistance.map { .number($0.doubleValue(for: .meter())) } ?? .null]); await model?.enqueue(OutboxItem(deviceId: deviceId, source: .healthkit, sourceId: workout.uuid.uuidString, observedAt: workout.endDate, record: record)) } }
    private nonisolated static func dayString(for date: Date) -> String {
        let components = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }
    private nonisolated static func unit(for identifier: String) -> HKUnit { switch identifier { case HKQuantityTypeIdentifier.activeEnergyBurned.rawValue, HKQuantityTypeIdentifier.basalEnergyBurned.rawValue: .kilocalorie(); case HKQuantityTypeIdentifier.appleExerciseTime.rawValue: .minute(); case HKQuantityTypeIdentifier.distanceWalkingRunning.rawValue: .mile(); case HKQuantityTypeIdentifier.restingHeartRate.rawValue: HKUnit.count().unitDivided(by: .minute()); case HKQuantityTypeIdentifier.heartRateVariabilitySDNN.rawValue: .secondUnit(with: .milli); default: .count() } }
}
enum HealthError: Error { case unavailable }
