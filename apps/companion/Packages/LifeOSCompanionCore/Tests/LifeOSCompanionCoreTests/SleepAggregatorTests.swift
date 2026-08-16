import XCTest
@testable import LifeOSCompanionCore

final class SleepAggregatorTests: XCTestCase {
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        value.locale = Locale(identifier: "en_US_POSIX")
        return value
    }

    func testOverlappingSourcesDoNotSumToImpossibleNight() {
        let start = date(2026, 8, 12, 22, 30)
        let end = date(2026, 8, 13, 6, 30)
        let samples = [
            interval(start, end, .core, bundle: "com.apple.health", name: "Apple Watch"),
            interval(start, end, .core, bundle: "com.ouraring.oura", name: "Oura"),
            interval(start, end, .core, bundle: "com.apple.health", name: "iPhone"),
        ]

        let nights = SleepAggregator.nights(from: samples, calendar: calendar)
        XCTAssertEqual(nights.map(\.day), ["2026-08-13"])
        XCTAssertEqual(nights[0].sourceName, "Apple Watch")
        XCTAssertEqual(nights[0].metrics["sleep_total_hours"]!, 8, accuracy: 0.01)
        XCTAssertEqual(nights[0].metrics["sleep_core_hours"]!, 8, accuracy: 0.01)
    }

    func testNightSpanningMidnightUsesWakeDay() {
        let samples = [
            interval(date(2026, 8, 14, 23, 0), date(2026, 8, 15, 7, 0), .deep, bundle: "com.apple.health", name: "Apple Watch"),
        ]
        let nights = SleepAggregator.nights(from: samples, calendar: calendar)
        XCTAssertEqual(nights.map(\.day), ["2026-08-15"])
        XCTAssertEqual(nights[0].metrics["sleep_total_hours"]!, 8, accuracy: 0.01)
    }

    func testOverlappingStagesFromOneSourceAreUnioned() {
        let start = date(2026, 8, 13, 22, 0)
        let mid = date(2026, 8, 14, 2, 0)
        let end = date(2026, 8, 14, 6, 0)
        let samples = [
            interval(start, end, .unspecified, bundle: "com.apple.health", name: "Apple Watch"),
            interval(start, mid, .core, bundle: "com.apple.health", name: "Apple Watch"),
            interval(mid, end, .deep, bundle: "com.apple.health", name: "Apple Watch"),
        ]
        let nights = SleepAggregator.nights(from: samples, calendar: calendar)
        XCTAssertEqual(nights[0].metrics["sleep_total_hours"]!, 8, accuracy: 0.01)
        XCTAssertEqual(nights[0].metrics["sleep_core_hours"]!, 4, accuracy: 0.01)
        XCTAssertEqual(nights[0].metrics["sleep_deep_hours"]!, 4, accuracy: 0.01)
    }

    private func interval(_ start: Date, _ end: Date, _ stage: SleepStage, bundle: String, name: String) -> SleepInterval {
        SleepInterval(start: start, end: end, stage: stage, sourceBundle: bundle, sourceName: name)
    }

    private func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }
}
