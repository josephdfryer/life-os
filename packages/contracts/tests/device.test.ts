import assert from "node:assert/strict"
import test from "node:test"
import { deviceHeartbeatContract, deviceIngestBatchContract } from "../index"

const base = {
  batchId: "batch-1",
  schemaVersion: 1,
  items: [{
    deviceId: "device-1",
    source: "healthkit",
    sourceId: "daily-2026-08-11",
    schemaVersion: 1,
    observedAt: "2026-08-11T18:00:00.000Z",
    record: { type: "health.daily", day: "2026-08-11", metrics: [{ key: "step_count", value: 1234 }] },
  }],
}

test("device batch accepts a bounded normalized health aggregate", () => {
  assert.equal(deviceIngestBatchContract.safeParse(base).success, true)
})

test("device batch accepts broad HealthKit summaries with explicit units", () => {
  const broad = structuredClone(base)
  broad.items[0].record.metrics = [
    { key: "sleep_deep_hours", value: 1.4, unit: "hr" },
    { key: "dietary_protein", value: 126, unit: "g" },
    { key: "blood_glucose", value: 94, unit: "mg/dL" },
  ] as never
  assert.equal(deviceIngestBatchContract.safeParse(broad).success, true)
})

test("device batch rejects raw payload and path fields", () => {
  const unsafe = structuredClone(base) as typeof base & { rawDatabase?: string }
  unsafe.items[0].record = { ...unsafe.items[0].record, rawSamples: [{ value: 1 }] } as never
  assert.equal(deviceIngestBatchContract.safeParse(unsafe).success, false)
})

test("device batch rejects raw GPS record types", () => {
  const unsafe = structuredClone(base)
  unsafe.items[0].source = "location"
  unsafe.items[0].record = { type: "location.ping", latitude: 1, longitude: 2 } as never
  assert.equal(deviceIngestBatchContract.safeParse(unsafe).success, false)
})

const heartbeatSource = {
  source: "healthkit",
  enabled: true,
  permissionStatus: "granted",
  healthStatus: "healthy",
  lastSuccessAt: "2026-08-15T20:58:02Z",
  lastErrorCode: null,
  schemaVersion: 1,
}

test("heartbeat accepts Swift ISO8601 dates without fractional seconds", () => {
  assert.equal(deviceHeartbeatContract.safeParse({ appVersion: "0.1.0", sources: [heartbeatSource] }).success, true)
})

test("heartbeat accepts omitted nullable fields and an extra id key", () => {
  const { lastSuccessAt: _lastSuccessAt, lastErrorCode: _lastErrorCode, ...omitted } = heartbeatSource
  assert.equal(deviceHeartbeatContract.safeParse({
    appVersion: "0.1.0",
    sources: [{ ...omitted, id: "healthkit" }],
  }).success, true)
})
