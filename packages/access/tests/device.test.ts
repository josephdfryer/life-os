import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { DEVICE_SCOPE_SETS, deviceAppForRedirectUri, deviceScopesForRedirectUri, hashToken, isAllowedDeviceRedirectUri, pkceChallenge } from "../device"

test("PKCE challenge is SHA-256 base64url without padding", () => {
  const verifier = "a".repeat(64)
  const expected = createHash("sha256").update(verifier).digest("base64url")
  assert.equal(pkceChallenge(verifier), expected)
  assert.match(pkceChallenge(verifier), /^[A-Za-z0-9_-]{43}$/)
})

test("stored token hash never contains the opaque credential", () => {
  const token = "dc_rt_private-value"
  const hash = hashToken(token)
  assert.equal(hash.length, 64)
  assert.equal(hash.includes(token), false)
})

test("device callbacks use an exact per-app allowlist", () => {
  assert.equal(isAllowedDeviceRedirectUri("lifeos-companion://auth/callback"), true)
  assert.equal(isAllowedDeviceRedirectUri("persons://auth/callback"), true)
  assert.equal(isAllowedDeviceRedirectUri("levelup://auth/callback"), true)
  assert.equal(isAllowedDeviceRedirectUri("persons://auth/other"), false)
  assert.equal(isAllowedDeviceRedirectUri("https://example.com/auth/callback"), false)
  assert.equal(isAllowedDeviceRedirectUri("not a url"), false)
})

test("each native app is identified by its registered redirect scheme", () => {
  assert.equal(deviceAppForRedirectUri("lifeos-companion://auth/callback"), "lifeos")
  assert.equal(deviceAppForRedirectUri("persons://auth/callback"), "persons")
  assert.equal(deviceAppForRedirectUri("levelup://auth/callback"), "levelup")
  assert.equal(deviceAppForRedirectUri("not a url"), "lifeos", "unknown input falls back to the least-privileged default that still ingests")
})

test("the Persons shell gets write scopes; the collector and Level Up do not", () => {
  const persons = deviceScopesForRedirectUri("persons://auth/callback")
  for (const scope of ["people.write", "interactions.write", "notes.write", "plans.write", "review.write"]) {
    assert.ok(persons.includes(scope), `persons must carry ${scope}`)
  }
  assert.ok(!persons.includes("workout.write"), "persons never logs workouts")
  const lifeos = deviceScopesForRedirectUri("lifeos-companion://auth/callback")
  assert.ok(lifeos.includes("people.read") && !lifeos.includes("people.write"))
  assert.ok(lifeos.includes("workout.write"))
  const levelup = deviceScopesForRedirectUri("levelup://auth/callback")
  assert.ok(levelup.includes("workout.write") && !levelup.includes("people.read"))
  for (const set of Object.values(DEVICE_SCOPE_SETS)) {
    for (const scope of ["device.ingest", "device.heartbeat", "device.self"]) assert.ok(set.includes(scope as never))
  }
})
