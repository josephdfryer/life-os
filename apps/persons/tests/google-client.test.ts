import assert from "node:assert/strict"
import test from "node:test"
import { googleFetch, googleJson, requestGoogleToken, type FetchLike } from "../server/integrations/google/client"

test("googleFetch injects a bearer token without leaking it into the URL", async () => {
  let captured: { input: string; init?: RequestInit } | null = null
  const fixture: FetchLike = async (input, init) => {
    captured = { input: String(input), init }
    return new Response("{}")
  }
  await googleFetch("https://example.test/resource", "secret-token", fixture)
  assert.equal(captured!.input, "https://example.test/resource")
  assert.deepEqual(captured!.init?.headers, { Authorization: "Bearer secret-token" })
})

test("requestGoogleToken posts URL-encoded OAuth fields", async () => {
  let request: RequestInit | undefined
  const fixture: FetchLike = async (_input, init) => {
    request = init
    return Response.json({ access_token: "access", expires_in: 3600 })
  }
  const token = await requestGoogleToken({ code: "abc", grant_type: "authorization_code" }, fixture)
  assert.equal(token.access_token, "access")
  assert.equal(request?.method, "POST")
  assert.equal(String(request?.body), "code=abc&grant_type=authorization_code")
})

test("googleJson supports fixture-backed provider responses and stable failures", async () => {
  const success: FetchLike = async () => Response.json({ items: [{ id: "one" }] })
  assert.deepEqual(await googleJson<{ items: { id: string }[] }>("https://example.test", "token", success), { items: [{ id: "one" }] })
  const failure: FetchLike = async () => new Response("nope", { status: 503 })
  await assert.rejects(() => googleJson("https://example.test", "token", failure), /503/)
})
