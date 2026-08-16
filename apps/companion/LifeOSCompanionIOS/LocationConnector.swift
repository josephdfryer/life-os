import CoreLocation
import Foundation
import LifeOSCompanionCore

@MainActor
final class LocationConnector: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager(); private weak var model: IOSCompanionModel?
    init(model: IOSCompanionModel) { self.model = model; super.init(); manager.delegate = self; manager.activityType = .other; manager.pausesLocationUpdatesAutomatically = true }
    func start() { manager.requestAlwaysAuthorization(); beginMonitoring() }
    func resumeIfAuthorized() { refreshStatus(); if manager.authorizationStatus == .authorizedAlways { beginMonitoring() } }
    func refreshStatus() { locationManagerDidChangeAuthorization(manager) }
    private func beginMonitoring() { if CLLocationManager.significantLocationChangeMonitoringAvailable() { manager.startMonitoringSignificantLocationChanges() }; manager.startMonitoringVisits() }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { switch manager.authorizationStatus { case .authorizedAlways: model?.locationStatus.permissionStatus = manager.accuracyAuthorization == .fullAccuracy ? .granted : .limited; model?.locationStatus.healthStatus = .healthy; case .denied, .restricted: model?.locationStatus.permissionStatus = .denied; model?.locationStatus.healthStatus = .error; model?.locationStatus.lastErrorCode = "location_authorization"; case .notDetermined: model?.locationStatus.permissionStatus = .notRequested; default: model?.locationStatus.permissionStatus = .limited } }
    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) { Task { @MainActor in guard let model, let deviceId = await model.api?.deviceId else { return }; let arrival = visit.arrivalDate == .distantPast ? Date() : visit.arrivalDate, departure: JSONValue = visit.departureDate == .distantFuture ? .null : .string(visit.departureDate.ISO8601Format()); let record = NormalizedRecord(type: "location.visit", fields: ["startedAt": .string(arrival.ISO8601Format()), "endedAt": departure, "latitude": .number(visit.coordinate.latitude), "longitude": .number(visit.coordinate.longitude), "horizontalAccuracyMeters": .number(visit.horizontalAccuracy), "placeName": .null]); let stable = "\(Int(arrival.timeIntervalSince1970))-\(Int(visit.coordinate.latitude * 100_000))-\(Int(visit.coordinate.longitude * 100_000))"; await model.enqueue(OutboxItem(deviceId: deviceId, source: .location, sourceId: stable, observedAt: arrival, record: record)); await model.sync() } }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { model?.locationStatus.healthStatus = .degraded; model?.locationStatus.lastErrorCode = "location_update_failed" }
}
