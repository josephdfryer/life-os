import Foundation
import OSLog
import SwiftUI

public enum DiagnosticLevel: String, Codable, Sendable {
    case info
    case warning
    case error
}

public struct DiagnosticEvent: Codable, Identifiable, Sendable {
    public let id: UUID
    public let timestamp: Date
    public let level: DiagnosticLevel
    public let category: String
    public let name: String
    public let detail: String?
    public let durationMilliseconds: Int?
}

/// A small, privacy-conscious, on-device flight recorder for Level Up.
/// It intentionally records product state and error codes, never health values,
/// workout loads, credentials, graph identifiers, or free-form server responses.
@MainActor
public final class DiagnosticLog: ObservableObject {
    public static let shared = DiagnosticLog()

    @Published public private(set) var events: [DiagnosticEvent] = []

    private let logger = Logger(subsystem: "com.lacollecteur.levelup", category: "diagnostics")
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let logURL: URL
    private let maximumEvents = 500

    private init() {
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let directory = base.appendingPathComponent("LevelUpDiagnostics", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        logURL = directory.appendingPathComponent("diagnostics.jsonl")
        events = Self.readEvents(from: logURL, decoder: decoder, limit: maximumEvents)
    }

    public func record(
        _ name: String,
        level: DiagnosticLevel = .info,
        category: String,
        detail: String? = nil,
        duration: TimeInterval? = nil
    ) {
        let event = DiagnosticEvent(
            id: UUID(),
            timestamp: Date(),
            level: level,
            category: category,
            name: name,
            detail: detail,
            durationMilliseconds: duration.map { Int(($0 * 1_000).rounded()) }
        )
        events.append(event)
        if events.count > maximumEvents {
            events.removeFirst(events.count - maximumEvents)
            rewriteLog()
        } else {
            append(event)
        }

        logger.log(level: osLogType(for: level), "\(category, privacy: .public).\(name, privacy: .public) \(detail ?? "", privacy: .public)")
    }

    public func record(error: Error, operation: String, category: String, duration: TimeInterval? = nil) {
        let value = error as NSError
        record(
            operation,
            level: .error,
            category: category,
            detail: "domain=\(value.domain) code=\(value.code)",
            duration: duration
        )
    }

    public func makeShareableReport() throws -> URL {
        let reportURL = FileManager.default.temporaryDirectory.appendingPathComponent("Level-Up-Diagnostics.txt")
        var lines = [
            "Level Up diagnostic report",
            "Generated: \(ISO8601DateFormatter().string(from: Date()))",
            "Privacy: no health values, workout loads, credentials, or graph identifiers are recorded.",
            "Events: \(events.count)",
            "",
        ]
        lines.append(contentsOf: events.map(Self.render))
        try lines.joined(separator: "\n").write(to: reportURL, atomically: true, encoding: .utf8)
        return reportURL
    }

    public func clear() {
        events = []
        try? FileManager.default.removeItem(at: logURL)
        record("cleared", category: "diagnostics")
    }

    private func append(_ event: DiagnosticEvent) {
        guard let data = try? encoder.encode(event) else { return }
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        guard let handle = try? FileHandle(forWritingTo: logURL) else { return }
        defer { try? handle.close() }
        do {
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.write(contentsOf: Data([0x0A]))
        } catch {
            logger.error("Could not persist diagnostic event")
        }
    }

    private func rewriteLog() {
        let data = events.compactMap { try? encoder.encode($0) }
            .reduce(into: Data()) { result, event in
                result.append(event)
                result.append(0x0A)
            }
        try? data.write(to: logURL, options: .atomic)
    }

    private func osLogType(for level: DiagnosticLevel) -> OSLogType {
        switch level {
        case .info: .info
        case .warning: .default
        case .error: .error
        }
    }

    private static func readEvents(from url: URL, decoder: JSONDecoder, limit: Int) -> [DiagnosticEvent] {
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else { return [] }
        return text.split(separator: "\n")
            .suffix(limit)
            .compactMap { try? decoder.decode(DiagnosticEvent.self, from: Data($0.utf8)) }
    }

    private static func render(_ event: DiagnosticEvent) -> String {
        let stamp = ISO8601DateFormatter().string(from: event.timestamp)
        let duration = event.durationMilliseconds.map { " duration=\($0)ms" } ?? ""
        let detail = event.detail.map { " \($0)" } ?? ""
        return "\(stamp) [\(event.level.rawValue.uppercased())] \(event.category).\(event.name)\(duration)\(detail)"
    }
}

struct DiagnosticsView: View {
    @ObservedObject private var log = DiagnosticLog.shared
    @State private var reportURL: URL?
    @State private var reportError: String?

    var body: some View {
        List {
            Section {
                Label("Recording on this phone", systemImage: "waveform.path.ecg")
                    .foregroundStyle(LevelUpStill.success)
                Text("Loading times, errors, screen changes, and app background/foreground events are retained across launches. Health values, workout loads, credentials, and graph identifiers are excluded.")
                    .font(.footnote)
                    .foregroundStyle(LevelUpStill.secondaryInk)
            }

            Section("Report an issue") {
                Button("Prepare diagnostic report") {
                    do {
                        reportURL = try log.makeShareableReport()
                        reportError = nil
                        log.record("report_prepared", category: "diagnostics")
                    } catch {
                        reportError = "The report could not be prepared."
                        log.record(error: error, operation: "report_failed", category: "diagnostics")
                    }
                }
                if let reportURL {
                    ShareLink(item: reportURL) {
                        Label("Share latest report", systemImage: "square.and.arrow.up")
                    }
                }
                if let reportError { Text(reportError).foregroundStyle(.red) }
            }

            Section("Recent activity") {
                if log.events.isEmpty {
                    Text("No events recorded yet.").foregroundStyle(LevelUpStill.mutedInk)
                } else {
                    ForEach(log.events.reversed()) { event in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text("\(event.category).\(event.name)").font(.caption.weight(.semibold))
                                Spacer()
                                Text(event.timestamp, style: .time).font(.caption2).foregroundStyle(LevelUpStill.mutedInk)
                            }
                            if let duration = event.durationMilliseconds {
                                Text("\(duration) ms").font(.caption2).foregroundStyle(LevelUpStill.secondaryInk)
                            }
                            if let detail = event.detail {
                                Text(detail).font(.caption2.monospaced()).foregroundStyle(LevelUpStill.secondaryInk)
                            }
                        }
                    }
                }
            }

            Section {
                Button("Clear diagnostic history", role: .destructive) { log.clear() }
            }

            Section("Credits") {
                Link("Exercise artwork by RepDB", destination: URL(string: "https://repdb.co")!)
                Text("Free-tier exercise artwork used under the RepDB data license.")
                    .font(.caption)
                    .foregroundStyle(LevelUpStill.mutedInk)
            }
        }
        .scrollContentBackground(.hidden)
        .background(LevelUpStill.background)
        .navigationTitle("Diagnostics")
    }
}
