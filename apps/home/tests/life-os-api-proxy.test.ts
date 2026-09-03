import assert from "node:assert/strict"
import test from "node:test"
import { proxyError } from "../lib/life-os-api-proxy"

test("proxyError returns stable error shape", () => {
  const response = proxyError("test_code", "Test message.", 503)
  assert.equal(response.status, 503)
})
