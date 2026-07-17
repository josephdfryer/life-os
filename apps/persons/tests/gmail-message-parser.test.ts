import assert from "node:assert/strict"
import test from "node:test"
import { parseAddressList, parseGmailMessage } from "../server/integrations/google/gmail-message-parser"

test("Gmail parser normalizes headers, parties, direction, date, and base64url body", () => {
  const body = Buffer.from("Hello from fixture").toString("base64url")
  const parsed = parseGmailMessage({
    id: "message-1", threadId: "thread-1", internalDate: "1704067200000", labelIds: ["SENT"], snippet: "snippet",
    payload: { mimeType: "multipart/alternative", headers: [
      { name: "Subject", value: "Fixture subject" },
      { name: "From", value: '"Joseph Fryer" <joseph@example.com>' },
      { name: "To", value: "Jane Doe <jane@example.com>, team@example.com" },
    ], parts: [{ mimeType: "text/plain", body: { data: body } }] },
  }, "joseph@example.com")
  assert.equal(parsed.subject, "Fixture subject")
  assert.equal(parsed.direction, "outgoing")
  assert.equal(parsed.body, "Hello from fixture")
  assert.deepEqual(parsed.to, [{ name: "Jane Doe", email: "jane@example.com" }, { name: null, email: "team@example.com" }])
  assert.equal(parsed.timestamp.toISOString(), "2024-01-01T00:00:00.000Z")
})

test("address parser preserves commas inside quoted display names", () => {
  assert.deepEqual(parseAddressList('"Doe, Jane" <jane@example.com>, joe@example.com'), [
    { name: "Doe, Jane", email: "jane@example.com" },
    { name: null, email: "joe@example.com" },
  ])
})
