import Foundation

/// One HealthKit sleep sample, already stripped of raw payload.
public struct SleepInterval: Sendable, Equatable {
    public let start: Date
    public let end: Date
    public let stage: SleepStage
    public let sourceBundle: String
    public let sourceName: String

    public init(start: Date, end: Date, stage: SleepStage, sourceBundle: String, sourceName: String) {
        self.start = start
        self.end = end
        self.stage = stage
        self.sourceBundle = sourceBundle
        self.sourceName = sourceName
    }
}

public enum SleepStage: String, Sendable, CaseIterable {
    case inBed, awake, unspecified, core, deep, rem

    public var metricKey: String {
        switch self {
        case .inBed: return "sleep_in_bed_hours"
        case .awake: return "sleep_awake_hours"
        case .unspecified: return "sleep_unspecified_hours"
        case .core: return "sleep_core_hours"
        case .deep: return "sleep_deep_hours"
        case .rem: return "sleep_rem_hours"
        }
    }

    public var countsAsAsleep: Bool {
        switch self {
        case .unspecified, .core, .deep, .rem: return true
        case .inBed, .awake: return false
        }
    }
}

public struct SleepNight: Sendable, Equatable {
    public let day: String
    public let metrics: [String: Double]
    public let sourceName: String

    public init(day: String, metrics: [String: Double], sourceName: String) {
        self.day = day
        self.metrics = metrics
        self.sourceName = sourceName
    }
}

/// HealthKit often stores the same night from Watch, iPhone, and Oura.
/// Summing every sample is what produced 31-hour "nights". Pick one source,
/// union overlapping intervals, and attribute the session to the wake day.
public enum SleepAggregator {
    public static func nights(from samples: [SleepInterval], calendar: Calendar = .current) -> [SleepNight] {
        let preferred = preferredSource(in: samples)
        let chosen = samples.filter { $0.sourceBundle == preferred.bundle && $0.sourceName == preferred.name }
        let asleep = chosen.filter(\.stage.countsAsAsleep).map { ($0.start, $0.end) }
        let sessions = mergeSessions(asleep, gap: 90 * 60)
        var byDay: [String: [String: Double]] = [:]

        for session in sessions {
            let day = dayString(for: session.end, calendar: calendar)
            let sessionSamples = chosen.filter { overlaps($0.start, $0.end, session.start, session.end) }
            var metrics = byDay[day] ?? [:]
            add(unionHours(sessionSamples.filter(\.stage.countsAsAsleep).map { ($0.start, $0.end) }), to: "sleep_total_hours", in: &metrics)
            for stage in SleepStage.allCases {
                let hours = unionHours(sessionSamples.filter { $0.stage == stage }.map { ($0.start, $0.end) })
                if hours > 0 { add(hours, to: stage.metricKey, in: &metrics) }
            }
            byDay[day] = metrics
        }

        return byDay.keys.sorted().compactMap { day in
            guard let metrics = byDay[day], (metrics["sleep_total_hours"] ?? 0) > 0 else { return nil }
            return SleepNight(day: day, metrics: metrics, sourceName: preferred.name)
        }
    }

    public static func preferredSource(in samples: [SleepInterval]) -> (bundle: String, name: String) {
        let groups = Dictionary(grouping: samples.filter(\.stage.countsAsAsleep), by: { "\($0.sourceBundle)\u{1e}\($0.sourceName)" })
        let ranked = groups.map { key, rows -> (bundle: String, name: String, rank: Int, hours: Double) in
            let bundle = rows[0].sourceBundle
            let name = rows[0].sourceName
            return (bundle, name, sourceRank(bundle: bundle, name: name), unionHours(rows.map { ($0.start, $0.end) }))
        }
        let best = ranked.max { lhs, rhs in
            if lhs.rank != rhs.rank { return lhs.rank > rhs.rank }
            return lhs.hours < rhs.hours
        }
        return (best?.bundle ?? "", best?.name ?? "")
    }

    static func sourceRank(bundle: String, name: String) -> Int {
        let haystack = "\(bundle) \(name)".lowercased()
        if haystack.contains("watch") { return 0 }
        if haystack.contains("oura") { return 1 }
        if haystack.contains("iphone") { return 3 }
        return 2
    }

    static func mergeSessions(_ intervals: [(Date, Date)], gap: TimeInterval) -> [(start: Date, end: Date)] {
        let sorted = intervals.filter { $0.1 > $0.0 }.sorted { $0.0 < $1.0 }
        var sessions: [(Date, Date)] = []
        for (start, end) in sorted {
            if let last = sessions.last, start.timeIntervalSince(last.1) <= gap {
                sessions[sessions.count - 1] = (last.0, max(last.1, end))
            } else {
                sessions.append((start, end))
            }
        }
        return sessions
    }

    static func unionHours(_ intervals: [(Date, Date)]) -> Double {
        let sorted = intervals.filter { $0.1 > $0.0 }.sorted { $0.0 < $1.0 }
        var total: TimeInterval = 0
        var cursor: (Date, Date)?
        for next in sorted {
            if let current = cursor, next.0 <= current.1 {
                cursor = (current.0, max(current.1, next.1))
            } else {
                if let current = cursor { total += current.1.timeIntervalSince(current.0) }
                cursor = next
            }
        }
        if let current = cursor { total += current.1.timeIntervalSince(current.0) }
        return total / 3_600
    }

    private static func overlaps(_ start: Date, _ end: Date, _ sessionStart: Date, _ sessionEnd: Date) -> Bool {
        start < sessionEnd && end > sessionStart
    }

    private static func add(_ hours: Double, to key: String, in metrics: inout [String: Double]) {
        metrics[key, default: 0] += hours
    }

    private static func dayString(for date: Date, calendar: Calendar) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }
}
