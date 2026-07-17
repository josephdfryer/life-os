import assert from "node:assert/strict"
import test from "node:test"
import { adminRequest, jsonRequest } from "../app/admin/api-client"

test("adminRequest returns typed JSON for successful responses", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ value: 42 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
  try {
    const result = await adminRequest<{ value: number }>("/api/test", undefined, "fallback")
    assert.equal(result.value, 42)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("adminRequest preserves the structured API error message", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Denied" } }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  })
  try {
    await assert.rejects(() => adminRequest("/api/test", undefined, "fallback"), /Denied/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("jsonRequest creates a consistent JSON mutation request", () => {
  assert.deepEqual(jsonRequest("PATCH", { status: "active" }), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "active" }),
  })
})
