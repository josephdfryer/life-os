import assert from "node:assert/strict"
import test from "node:test"
import {
  configurationEventStatus,
  isMapKitJsToken,
  mapKitErrorMessage,
  mapKitLoadOptions,
  sanitizeMapKitToken,
  subscribeMapKitErrors,
  type MapKitAuthTarget,
} from "../components/map/apple-map-auth"

function createAuthTarget(): MapKitAuthTarget & {
  emit: (type: string, event: Event) => void
} {
  const listeners = new Map<string, Set<(event: Event) => void>>()
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

function statusEvent(status: string): Event {
  return Object.assign(new Event("error"), { status })
}

function detailEvent(status: string): Event {
  return Object.assign(new Event("error"), { detail: { status } })
}

test("MapKit tokens drop surrounding and internal whitespace from env pastes", () => {
  assert.equal(sanitizeMapKitToken("  abc.def  \n"), "abc.def")
  assert.equal(sanitizeMapKitToken("eyJhbGciOiJFUzI1NiJ9.\neyJpc3MiOiJ0ZWFtIn0.\nabc"), "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJ0ZWFtIn0.abc")
  assert.equal(sanitizeMapKitToken("   \n"), undefined)
  assert.equal(sanitizeMapKitToken(undefined), undefined)
})

test("only JWT-shaped values count as MapKit JS tokens", () => {
  assert.equal(isMapKitJsToken("eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJ0ZWFtIn0.abc"), true)
  assert.equal(isMapKitJsToken("  eyJhbGciOiJFUzI1NiJ9.\neyJpc3MiOiJ0ZWFtIn0.\nabc  "), true)
  assert.equal(isMapKitJsToken("maps.com.lacollecteur.places"), false)
  assert.equal(isMapKitJsToken("A copied token name with spaces"), false)
  assert.equal(isMapKitJsToken(""), false)
  assert.equal(isMapKitJsToken(undefined), false)
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
  assert.equal(configurationEventStatus(statusEvent("Initialized")), "Initialized")
  assert.equal(configurationEventStatus(detailEvent("Unauthorized")), "Unauthorized")
})

test("MapKit error events become actionable overlay copy", () => {
  const mapkit = createAuthTarget()
  const messages: string[] = []
  const unsubscribe = subscribeMapKitErrors(mapkit, message => messages.push(message))
  mapkit.emit("error", statusEvent("Unauthorized"))
  unsubscribe()
  mapkit.emit("error", statusEvent("Unauthorized"))
  assert.equal(messages.length, 1)
  assert.match(messages[0]!, /places\.lacollecteur\.com/)
})
