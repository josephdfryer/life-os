import assert from "node:assert/strict"
import test from "node:test"
import {
  initializeMapKit,
  mapKitErrorMessage,
  sanitizeMapKitToken,
  waitForMapKitConfiguration,
  type MapKitAuthTarget,
  type MapKitInitializable,
} from "../components/map/apple-map-auth"

function createAuthTarget(): MapKitAuthTarget & {
  emit: (type: string, event: { status?: string }) => void
} {
  const listeners = new Map<string, Set<(event: { status?: string }) => void>>()
  return {
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? new Set()
      bucket.add(listener)
      listeners.set(type, bucket)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    emit(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
  }
}

test("MapKit tokens drop surrounding whitespace from env pastes", () => {
  assert.equal(sanitizeMapKitToken("  abc.def  \n"), "abc.def")
  assert.equal(sanitizeMapKitToken("   \n"), undefined)
  assert.equal(sanitizeMapKitToken(undefined), undefined)
})

test("unauthorized MapKit status points at the domain-restricted token", () => {
  assert.match(mapKitErrorMessage("Unauthorized"), /places\.lacollecteur\.com/)
  assert.match(mapKitErrorMessage("Timeout"), /apple-mapkit\.com/)
})

test("Map creation waits for MapKit authorization before resolving", async () => {
  const mapkit = createAuthTarget()
  const pending = waitForMapKitConfiguration(mapkit, 200)
  queueMicrotask(() => mapkit.emit("configuration-change", { status: "Initialized" }))
  await pending
})

test("MapKit authorization failures become actionable errors", async () => {
  const mapkit = createAuthTarget()
  const pending = waitForMapKitConfiguration(mapkit, 200)
  queueMicrotask(() => mapkit.emit("error", { status: "Unauthorized" }))
  await assert.rejects(pending, /places\.lacollecteur\.com/)
})

test("MapKit init is registered before the authorization wait", async () => {
  const events: string[] = []
  const mapkit = Object.assign(createAuthTarget(), {
    init() {
      events.push("init")
      queueMicrotask(() => {
        events.push("initialized")
        mapkit.emit("configuration-change", { status: "Initialized" })
      })
    },
  }) satisfies MapKitInitializable & { emit: (type: string, event: { status?: string }) => void }

  await initializeMapKit(mapkit, "token", 200)
  assert.deepEqual(events, ["init", "initialized"])
})
