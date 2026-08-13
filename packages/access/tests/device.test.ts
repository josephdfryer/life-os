import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { hashToken, pkceChallenge } from "../device"

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
