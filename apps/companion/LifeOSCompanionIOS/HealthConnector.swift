import CryptoKit
import Foundation
import HealthKit
import LifeOSCompanionCore

@MainActor
final class HealthConnector {
    private struct DailyMetric {
        let key: String
        let value: Double
        let unit: String
    }

    enum CollectMode {
        case readyDays
        case sleepOnly
        case workoutsOnly
    }

    private let store = HKHealthStore()
    private weak var model: IOSCompanionModel?
    private var observersStarted = false
    private var observerQueries: [HKObserverQuery] = []

    // Raw identifiers let the same binary ask for every standard type the
    // installed OS supports. Unknown/newer identifiers simply resolve to nil
    // on older iOS versions instead of becoming availability-check sprawl.
    private let quantityNames = [
        "ActiveEnergyBurned", "AppleExerciseTime", "AppleMoveTime", "AppleSleepingBreathingDisturbances",
        "AppleSleepingWristTemperature", "AppleStandTime", "AppleWalkingSteadiness", "AtrialFibrillationBurden",
        "BasalBodyTemperature", "BasalEnergyBurned", "BloodAlcoholContent", "BloodGlucose",
        "BloodPressureDiastolic", "BloodPressureSystolic", "BodyFatPercentage", "BodyMass", "BodyMassIndex",
        "BodyTemperature", "CrossCountrySkiingSpeed", "CyclingCadence", "CyclingFunctionalThresholdPower",
        "CyclingPower", "CyclingSpeed", "DietaryBiotin", "DietaryCaffeine", "DietaryCalcium",
        "DietaryCarbohydrates", "DietaryChloride", "DietaryCholesterol", "DietaryChromium", "DietaryCopper",
        "DietaryEnergyConsumed", "DietaryFatMonounsaturated", "DietaryFatPolyunsaturated", "DietaryFatSaturated",
        "DietaryFatTotal", "DietaryFiber", "DietaryFolate", "DietaryIodine", "DietaryIron", "DietaryMagnesium",
        "DietaryManganese", "DietaryMolybdenum", "DietaryNiacin", "DietaryPantothenicAcid", "DietaryPhosphorus",
        "DietaryPotassium", "DietaryProtein", "DietaryRiboflavin", "DietarySelenium", "DietarySodium",
        "DietarySugar", "DietaryThiamin", "DietaryVitaminA", "DietaryVitaminB12", "DietaryVitaminB6",
        "DietaryVitaminC", "DietaryVitaminD", "DietaryVitaminE", "DietaryVitaminK", "DietaryWater", "DietaryZinc",
        "DistanceCrossCountrySkiing", "DistanceCycling", "DistanceDownhillSnowSports", "DistancePaddleSports",
        "DistanceRowing", "DistanceSkatingSports", "DistanceSwimming", "DistanceWalkingRunning", "DistanceWheelchair",
        "ElectrodermalActivity", "EnvironmentalAudioExposure", "EnvironmentalSoundReduction",
        "EstimatedWorkoutEffortScore", "FlightsClimbed", "ForcedExpiratoryVolume1", "ForcedVitalCapacity",
        "HeadphoneAudioExposure", "HeartRate", "HeartRateRecoveryOneMinute", "HeartRateVariabilitySDNN", "Height",
        "InhalerUsage", "InsulinDelivery", "LeanBodyMass", "NikeFuel", "NumberOfAlcoholicBeverages",
        "NumberOfTimesFallen", "OxygenSaturation", "PaddleSportsSpeed", "PeakExpiratoryFlowRate",
        "PeripheralPerfusionIndex", "PhysicalEffort", "PushCount", "RespiratoryRate", "RestingHeartRate",
        "RowingSpeed", "RunningGroundContactTime", "RunningPower", "RunningSpeed", "RunningStrideLength",
        "RunningVerticalOscillation", "SixMinuteWalkTestDistance", "StairAscentSpeed", "StairDescentSpeed",
        "StepCount", "SwimmingStrokeCount", "TimeInDaylight", "UVExposure", "UnderwaterDepth", "VO2Max",
        "WaistCircumference", "WalkingAsymmetryPercentage", "WalkingDoubleSupportPercentage",
        "WalkingHeartRateAverage", "WalkingSpeed", "WalkingStepLength", "WaterTemperature", "WorkoutEffortScore",
    ]

    private let categoryNames = [
        "AbdominalCramps", "Acne", "AppetiteChanges", "AppleStandHour", "AppleWalkingSteadinessEvent",
        "BladderIncontinence", "BleedingAfterPregnancy", "BleedingDuringPregnancy", "Bloating", "BreastPain",
        "CervicalMucusQuality", "ChestTightnessOrPain", "Chills", "Constipation", "Contraceptive", "Coughing",
        "Diarrhea", "Dizziness", "DrySkin", "EnvironmentalAudioExposureEvent", "Fainting", "Fatigue", "Fever",
        "GeneralizedBodyAche", "HairLoss", "HandwashingEvent", "Headache", "HeadphoneAudioExposureEvent",
        "Heartburn", "HighHeartRateEvent", "HotFlashes", "HypertensionEvent", "InfrequentMenstrualCycles",
        "IntermenstrualBleeding", "IrregularHeartRhythmEvent", "IrregularMenstrualCycles", "Lactation", "LossOfSmell",
        "LossOfTaste", "LowCardioFitnessEvent", "LowHeartRateEvent", "LowerBackPain", "MemoryLapse", "MenstrualFlow",
        "MindfulSession", "MoodChanges", "Nausea", "NightSweats", "OvulationTestResult", "PelvicPain",
        "PersistentIntermenstrualBleeding", "Pregnancy", "PregnancyTestResult", "ProgesteroneTestResult",
        "ProlongedMenstrualPeriods", "RapidPoundingOrFlutteringHeartbeat", "RunnyNose", "SexualActivity",
        "ShortnessOfBreath", "SinusCongestion", "SkippedHeartbeat", "SleepAnalysis", "SleepApneaEvent", "SleepChanges",
        "SoreThroat", "ToothbrushingEvent", "VaginalDryness", "Vomiting", "Wheezing",
    ]

    private let keyOverrides = [
        "ActiveEnergyBurned": "active_energy", "BasalEnergyBurned": "resting_energy",
        "AppleExerciseTime": "apple_exercise_time", "StepCount": "step_count", "FlightsClimbed": "flights_climbed",
        "DistanceWalkingRunning": "walking_running_distance", "RestingHeartRate": "resting_heart_rate",
        "HeartRateVariabilitySDNN": "heart_rate_variability", "OxygenSaturation": "blood_oxygen_saturation",
    ]

    init(model: IOSCompanionModel) {
        self.model = model
    }

    func authorizeAndStart() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw HealthError.unavailable }
        let quantities = quantityTypes()
        let categories = categoryTypes()
        var read = Set<HKObjectType>(quantities.map(\.type))
        read.formUnion(categories.map(\.type))
        read.insert(HKObjectType.workoutType())
        try await store.requestAuthorization(toShare: [], read: read)
        UserDefaults.standard.set(true, forKey: "lifeos.health.enabled")
        startObserversIfNeeded()
        await collect(.readyDays)
    }

    func collectIncremental() async { await collect(.readyDays) }
    func collectSleep() async { await collect(.sleepOnly) }
    func collectWorkouts() async { await collect(.workoutsOnly) }

    func collect(_ mode: CollectMode) async {
        guard let model, let deviceId = await model.api?.deviceId else { return }
        var calendar = Calendar.current
        calendar.locale = Locale(identifier: "en_US_POSIX")
        let now = Date()
        let activityWindow = completedActivityWindow(now: now, calendar: calendar)
        let sleepStart = calendar.date(byAdding: .hour, value: -16, to: calendar.startOfDay(for: calendar.date(byAdding: .day, value: -2, to: now)!))!

        if mode != .workoutsOnly {
            var days: [String: [String: DailyMetric]] = [:]
            // Always attach completed-day activity when writing sleep so a
            // morning sleep ingest cannot replace yesterday's Note and wipe steps.
            await collectActivity(from: activityWindow.start, to: activityWindow.end, into: &days)
            await collectSleep(from: sleepStart, to: now, calendar: calendar, into: &days)
            await enqueueDays(days, deviceId: deviceId, observedAt: now)
        }

        if mode != .sleepOnly {
            await collectWorkouts(deviceId: deviceId, since: activityWindow.start)
        }
        model.healthStatus.lastSuccessAt = Date()
        model.healthStatus.healthStatus = .healthy
        model.healthStatus.lastErrorCode = nil
    }

    private func startObserversIfNeeded() {
        guard !observersStarted else { return }
        observersStarted = true
        let watched: [(HKSampleType, HKUpdateFrequency)] = [
            (HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!, .immediate),
            (.workoutType(), .immediate),
        ]
        for (type, frequency) in watched {
            store.enableBackgroundDelivery(for: type, frequency: frequency) { _, _ in }
            let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completion, _ in
                Task { @MainActor in
                    if type == .workoutType() {
                        await self?.model?.syncWorkoutsFromObserver()
                    } else {
                        await self?.model?.syncSleepFromObserver()
                    }
                    completion()
                }
            }
            observerQueries.append(query)
            store.execute(query)
        }
    }

    private func completedActivityWindow(now: Date, calendar: Calendar) -> (start: Date, end: Date) {
        let todayStart = calendar.startOfDay(for: now)
        let minutes = (calendar.component(.hour, from: now) * 60) + calendar.component(.minute, from: now)
        let includeToday = minutes >= (23 * 60 + 50)
        let start = calendar.date(byAdding: .day, value: -1, to: todayStart)!
        return (start, includeToday ? now : todayStart)
    }

    private func collectActivity(from start: Date, to end: Date, into days: inout [String: [String: DailyMetric]]) async {
        guard start < end else { return }
        let quantities = quantityTypes()
        let units = await preferredUnits(for: Set(quantities.map(\.type)))
        for quantity in quantities {
            guard let unit = units[quantity.type] else { continue }
            let options: HKStatisticsOptions = quantity.type.aggregationStyle == .cumulative ? .cumulativeSum : .discreteAverage
            for (day, value) in await statistics(type: quantity.type, unit: unit, options: options, start: start, end: end) {
                days[day, default: [:]][quantity.key] = DailyMetric(key: quantity.key, value: value, unit: unit.unitString)
            }
        }
        for category in categoryTypes() where category.name != "SleepAnalysis" {
            let samples = await categorySamples(type: category.type, start: start, end: end)
            aggregateCategory(category.key, samples: samples, into: &days)
        }
    }

    private func collectSleep(from start: Date, to end: Date, calendar: Calendar, into days: inout [String: [String: DailyMetric]]) async {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return }
        let samples = await categorySamples(type: sleepType, start: start, end: end)
        let intervals = samples.compactMap { sample -> SleepInterval? in
            guard let stage = Self.sleepStage(for: sample.value) else { return nil }
            return SleepInterval(
                start: sample.startDate,
                end: sample.endDate,
                stage: stage,
                sourceBundle: sample.sourceRevision.source.bundleIdentifier,
                sourceName: sample.sourceRevision.source.name
            )
        }
        for night in SleepAggregator.nights(from: intervals, calendar: calendar) {
            for (key, hours) in night.metrics {
                days[night.day, default: [:]][key] = DailyMetric(key: key, value: hours, unit: "hr")
            }
        }
    }

    private func enqueueDays(_ days: [String: [String: DailyMetric]], deviceId: String, observedAt: Date) async {
        for day in days.keys.sorted() {
            let metrics = (days[day] ?? [:]).values.sorted { $0.key < $1.key }
            guard !metrics.isEmpty else { continue }
            let wireMetrics = metrics.map { metric in
                JSONValue.object(["key": .string(metric.key), "value": .number(metric.value), "unit": .string(metric.unit)])
            }
            let fingerprint = metrics.map { "\($0.key)=\($0.value):\($0.unit)" }.joined(separator: "|")
            let digest = SHA256.hash(data: Data(fingerprint.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
            let record = NormalizedRecord(type: "health.daily", fields: ["day": .string(day), "metrics": .array(wireMetrics)])
            await model?.enqueue(OutboxItem(deviceId: deviceId, source: .healthkit, sourceId: "daily-\(day)-\(digest)", observedAt: observedAt, record: record))
        }
    }

    private func quantityTypes() -> [(name: String, key: String, type: HKQuantityType)] {
        quantityNames.compactMap { name in
            let identifier = HKQuantityTypeIdentifier(rawValue: "HKQuantityTypeIdentifier\(name)")
            guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return nil }
            return (name, keyOverrides[name] ?? Self.snakeCase(name), type)
        }
    }

    private func categoryTypes() -> [(name: String, key: String, type: HKCategoryType)] {
        categoryNames.compactMap { name in
            let identifier = HKCategoryTypeIdentifier(rawValue: "HKCategoryTypeIdentifier\(name)")
            guard let type = HKObjectType.categoryType(forIdentifier: identifier) else { return nil }
            return (name, Self.snakeCase(name), type)
        }
    }

    private func preferredUnits(for types: Set<HKQuantityType>) async -> [HKQuantityType: HKUnit] {
        guard !types.isEmpty else { return [:] }
        return await withCheckedContinuation { continuation in
            store.preferredUnits(for: types) { units, _ in continuation.resume(returning: units) }
        }
    }

    private func statistics(type: HKQuantityType, unit: HKUnit, options: HKStatisticsOptions, start: Date, end: Date) async -> [(String, Double)] {
        await withCheckedContinuation { continuation in
            var interval = DateComponents()
            interval.day = 1
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end),
                options: options,
                anchorDate: Calendar.current.startOfDay(for: start),
                intervalComponents: interval
            )
            query.initialResultsHandler = { _, results, _ in
                var output: [(String, Double)] = []
                results?.enumerateStatistics(from: start, to: end) { statistic, _ in
                    let quantity = options.contains(.cumulativeSum) ? statistic.sumQuantity() : statistic.averageQuantity()
                    if let quantity { output.append((Self.dayString(for: statistic.startDate), quantity.doubleValue(for: unit))) }
                }
                continuation.resume(returning: output)
            }
            store.execute(query)
        }
    }

    private func categorySamples(type: HKCategoryType, start: Date, end: Date) async -> [HKCategorySample] {
        await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: HKQuery.predicateForSamples(withStart: start, end: end),
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, _ in
                continuation.resume(returning: samples as? [HKCategorySample] ?? [])
            }
            store.execute(query)
        }
    }

    private func aggregateCategory(_ key: String, samples: [HKCategorySample], into days: inout [String: [String: DailyMetric]]) {
        for sample in samples {
            let day = Self.dayString(for: sample.startDate)
            add(key: "\(key)_count", value: 1, unit: "count", day: day, into: &days)
            let minutes = max(0, sample.endDate.timeIntervalSince(sample.startDate) / 60)
            if minutes > 0 { add(key: "\(key)_minutes", value: minutes, unit: "min", day: day, into: &days) }
            add(key: "\(key)_value_total", value: Double(sample.value), unit: "score", day: day, into: &days)
        }
    }

    private func add(key: String, value: Double, unit: String, day: String, into days: inout [String: [String: DailyMetric]]) {
        let previous = days[day]?[key]?.value ?? 0
        days[day, default: [:]][key] = DailyMetric(key: key, value: previous + value, unit: unit)
    }

    private func collectWorkouts(deviceId: String, since: Date) async {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: since, end: Date()))],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        guard let workouts = try? await descriptor.result(for: store) else { return }
        for workout in workouts {
            let record = NormalizedRecord(type: "health.workout", fields: [
                "workoutType": .string(String(workout.workoutActivityType.rawValue)),
                "startedAt": .string(workout.startDate.ISO8601Format()),
                "endedAt": .string(workout.endDate.ISO8601Format()),
                "durationSeconds": .number(workout.duration),
                "energyKcal": workout.totalEnergyBurned.map { .number($0.doubleValue(for: .kilocalorie())) } ?? .null,
                "distanceMeters": workout.totalDistance.map { .number($0.doubleValue(for: .meter())) } ?? .null,
            ])
            await model?.enqueue(OutboxItem(deviceId: deviceId, source: .healthkit, sourceId: workout.uuid.uuidString, observedAt: workout.endDate, record: record))
        }
    }

    private nonisolated static func sleepStage(for value: Int) -> SleepStage? {
        switch value {
        case HKCategoryValueSleepAnalysis.inBed.rawValue: return .inBed
        case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue: return .unspecified
        case HKCategoryValueSleepAnalysis.awake.rawValue: return .awake
        case HKCategoryValueSleepAnalysis.asleepCore.rawValue: return .core
        case HKCategoryValueSleepAnalysis.asleepDeep.rawValue: return .deep
        case HKCategoryValueSleepAnalysis.asleepREM.rawValue: return .rem
        default: return nil
        }
    }

    private nonisolated static func dayString(for date: Date) -> String {
        let components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }

    private nonisolated static func snakeCase(_ value: String) -> String {
        value
            .replacingOccurrences(of: "([a-z0-9])([A-Z])", with: "$1_$2", options: .regularExpression)
            .replacingOccurrences(of: "([A-Z]+)([A-Z][a-z])", with: "$1_$2", options: .regularExpression)
            .lowercased()
    }
}

enum HealthError: Error { case unavailable }
