import assert from "node:assert/strict"
import test from "node:test"
import {
  assembleStreamRows,
  classifyStream,
  describeDatabaseStore,
  sortStreamRows,
  STREAM_SPECS,
  streamDetailPath,
  summarizeStreamRows,
} from "../lib/data-streams"

const NOW = Date.parse("2026-08-29T18:00:00.000Z")
const MINUTE = 60_000

test("classifyStream treats graph arrival as the source of truth", () => {
  assert.equal(classifyStream({
    connected: false, collectorAt: null, collectorError: null, arrivalAt: null, staleAfterMs: 30 * MINUTE, now: NOW,
  }), "not_connected")
  assert.equal(classifyStream({
    connected: true, collectorAt: new Date(NOW - 5 * MINUTE), collectorError: "token expired", arrivalAt: null, staleAfterMs: 30 * MINUTE, now: NOW,
  }), "error")
  assert.equal(classifyStream({
    connected: true, collectorAt: new Date(NOW - 5 * MINUTE), collectorError: "token expired", arrivalAt: new Date(NOW - 2 * MINUTE), staleAfterMs: 30 * MINUTE, now: NOW,
  }), "streaming")
  assert.equal(classifyStream({
    connected: true, collectorAt: new Date(NOW - 5 * MINUTE), collectorError: null, arrivalAt: null, staleAfterMs: 30 * MINUTE, now: NOW,
  }), "silent")
  assert.equal(classifyStream({
    connected: true, collectorAt: new Date(NOW - 2 * 60 * MINUTE), collectorError: null, arrivalAt: new Date(NOW - 2 * 60 * MINUTE), staleAfterMs: 30 * MINUTE, now: NOW,
  }), "stale")
})

test("assembleStreamRows emits one row per account and hides nothing expected", () => {
  const rows = assembleStreamRows({
    connections: [
      { id: "g1", kind: "gmail", status: "active", accountEmail: "a@example.com", label: "Personal", lastSyncedAt: new Date(NOW - 10 * MINUTE), lastError: null },
      { id: "g2", kind: "gmail", status: "active", accountEmail: "b@example.com", label: "Work", lastSyncedAt: new Date(NOW - 10 * MINUTE), lastError: null },
    ],
    devices: [
      { deviceId: "mac", deviceName: "Mac Studio", revokedAt: null, source: "whatsapp", enabled: true, permissionStatus: "authorized", lastSuccessAt: new Date(NOW - 4 * MINUTE), lastErrorCode: null },
    ],
    arrivals: [
      { source: "gmail", at: new Date(NOW - 12 * MINUTE) },
      { source: "whatsapp", at: new Date(NOW - 4 * MINUTE) },
    ],
    volumes: [
      { source: "gmail", accepted: 4, staged: 1, failed: 0 },
      { source: "whatsapp", accepted: 2, staged: 0, failed: 0 },
    ],
    now: NOW,
  })

  const gmail = rows.filter(row => row.spec.kind === "gmail")
  assert.equal(gmail.length, 2)
  assert.equal(gmail[0].status, "streaming")
  assert.equal(gmail[0].accepted24h, 4)

  const whatsapp = rows.find(row => row.spec.kind === "whatsapp")
  assert.equal(whatsapp?.title, "WhatsApp · Mac Studio")
  assert.equal(whatsapp?.status, "streaming")

  const granola = rows.find(row => row.spec.kind === "meetings")
  assert.equal(granola?.status, "not_connected")
  assert.equal(granola?.id, "expected:meetings")

  assert.equal(rows.length, STREAM_SPECS.length + 1)
})

test("arrival without a connection still surfaces a laptop stream as stale or streaming", () => {
  const rows = assembleStreamRows({
    connections: [],
    devices: [],
    arrivals: [{ source: "imessage", at: new Date(NOW - 2 * MINUTE) }],
    volumes: [{ source: "imessage", accepted: 3, staged: 8, failed: 0 }],
    now: NOW,
  })
  const imessage = rows.find(row => row.spec.kind === "imessage")
  assert.equal(imessage?.id, "arrival:imessage")
  assert.equal(imessage?.status, "streaming")
  assert.equal(imessage?.staged24h, 8)
})

test("revoked devices and denied permissions do not count as connected", () => {
  const rows = assembleStreamRows({
    connections: [],
    devices: [
      { deviceId: "old", deviceName: "Old phone", revokedAt: new Date(NOW - DAY()), source: "healthkit", enabled: true, permissionStatus: "authorized", lastSuccessAt: new Date(NOW), lastErrorCode: null },
      { deviceId: "iphone", deviceName: "iPhone", revokedAt: null, source: "healthkit", enabled: true, permissionStatus: "denied", lastSuccessAt: null, lastErrorCode: "permission_denied" },
    ],
    arrivals: [],
    volumes: [],
    now: NOW,
  })
  const health = rows.filter(row => row.spec.kind === "healthkit")
  assert.equal(health.length, 1)
  assert.equal(health[0].status, "error")
})

test("summarizeStreamRows counts attention separately from not connected", () => {
  const rows = assembleStreamRows({
    connections: [
      { id: "era", kind: "era", status: "active", accountEmail: null, label: "Era", lastSyncedAt: new Date(NOW - 5 * MINUTE), lastError: "mcp timeout" },
    ],
    devices: [],
    arrivals: [],
    volumes: [],
    now: NOW,
  })
  const summary = summarizeStreamRows(rows)
  assert.equal(summary.error, 1)
  assert.ok(summary.notConnected >= 1)
  assert.equal(summary.streaming, 0)
  assert.ok(summary.needsAttention >= 1)
})

test("sortStreamRows puts failures first and keeps titles stable", () => {
  const rows = assembleStreamRows({
    connections: [
      { id: "era", kind: "era", status: "active", accountEmail: null, label: "Era", lastSyncedAt: new Date(NOW - 5 * MINUTE), lastError: "mcp timeout" },
      { id: "gmail", kind: "gmail", status: "active", accountEmail: "a@example.com", label: "Gmail", lastSyncedAt: new Date(NOW - 5 * MINUTE), lastError: null },
    ],
    devices: [],
    arrivals: [{ source: "gmail", at: new Date(NOW - 2 * MINUTE) }],
    volumes: [],
    now: NOW,
  })
  const sorted = sortStreamRows(rows)
  assert.equal(sorted[0]?.spec.kind, "era")
  assert.equal(sorted[0]?.status, "error")
  assert.ok(sorted.findIndex(row => row.status === "streaming") < sorted.findIndex(row => row.status === "not_connected"))
})

test("streamDetailPath encodes the row id for the admin drill-down", () => {
  assert.equal(streamDetailPath("connection:g1"), "/admin/health/streams/connection%3Ag1")
})

test("describeDatabaseStore never echoes credentials and recognizes Neon", () => {
  assert.deepEqual(
    describeDatabaseStore("postgresql://user:secret@ep-example-pooler.us-west-2.aws.neon.tech/neondb"),
    { label: "Neon · ep-example-pooler.us-west-2.aws.neon.tech", neon: true },
  )
  assert.deepEqual(describeDatabaseStore("postgresql://lifeos:lifeos@localhost:5432/lifeos"), { label: "PostgreSQL · local", neon: false })
  assert.equal(describeDatabaseStore("postgresql://user:secret@localhost:5432/lifeos").label.includes("secret"), false)
})

function DAY() {
  return 24 * 60 * MINUTE
}
