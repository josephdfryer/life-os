import assert from "node:assert/strict"
import test from "node:test"
import {
  configurationEventStatus,
  mapKitErrorMessage,
  mapKitLoadOptions,
  sanitizeMapKitToken,
  subscribeMapKitErrors,
  type MapKitAuthTarget,
} from "../components/map/apple-map-auth"

function createAuthTarget(): MapKitAuthTarget & {
  emit: (type: string, event: { status?: string; detail?: { status?: string } }) => void
} {
  const listeners = new Map<string, Set<(event: { status?: string; detail?: { status?: string } }) => void>>()
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

test("loader options pass the token and MapKit JS 6 libraries", () => {
  assert.deepEqual(mapKitLoadOptions("token"), {
    token: "token",
    language: "en-US",
    libraries: ["full-map", "annotations"],
  })
})

test("unauthorized MapKit status points at the domain-restricted token", () => {
  assert.match(mapKitErrorMessage("Unauthorized"), /places\.lacollecteur\.com/)
  assert.match(mapKitErrorMessage("Network Error"), /apple-mapkit\.com/)
  assert.match(mapKitErrorMessage(), /allowed domains/)
})

test("configuration status is read from the event or its detail", () => {
  assert.equal(configurationEventStatus({ status: "Initialized" }), "Initialized")
  assert.equal(configurationEventStatus({ detail: { status: "Unauthorized" } }), "Unauthorized")
})

test("MapKit error events become actionable overlay copy", () => {
  const mapkit = createAuthTarget()
  const messages: string[] = []
  const unsubscribe = subscribeMapKitErrors(mapkit, message => messages.push(message))
  mapkit.emit("error", { status: "Unauthorized" })
  unsubscribe()
  mapkit.emit("error", { status: "Unauthorized" })
  assert.equal(messages.length, 1)
  assert.match(messages[0]!, /places\.lacollecteur\.com/)
})
