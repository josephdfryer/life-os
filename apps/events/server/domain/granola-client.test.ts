import assert from "node:assert/strict"
import test from "node:test"
import { GranolaClient, formatGranolaTranscript } from "./granola-client"

test("listAllNotes follows every cursor without a fixed cap", async () => {
  const urls: string[] = []
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    const cursor = new URL(url).searchParams.get("cursor")
    return Response.json(cursor
      ? { notes: [{ id: "third" }], hasMore: false, cursor: null }
      : { notes: [{ id: "first" }, { id: "second" }], hasMore: true, cursor: "page-2" })
  }
  const client = new GranolaClient("grn_test", fetcher as typeof fetch, "https://example.test/v1")
  const notes = await client.listAllNotes({ updatedAfter: new Date("2026-08-01T00:00:00.000Z") })
  assert.deepEqual(notes.map(note => note.id), ["first", "second", "third"])
  assert.equal(urls.length, 2)
  assert.equal(new URL(urls[1]).searchParams.get("cursor"), "page-2")
  assert.equal(new URL(urls[0]).searchParams.get("page_size"), "30")
})

test("getNote falls back to every transcript page when inline transcript is too large", async () => {
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.searchParams.get("include") === "transcript") {
      return Response.json({ error: { code: "TRANSCRIPT_TOO_LARGE", message: "too large" } }, { status: 413 })
    }
    if (url.pathname.endsWith("/transcript")) {
      const cursor = url.searchParams.get("cursor")
      return Response.json(cursor
        ? { transcript: [{ text: "Second", speaker: { name: "Tyler" } }], hasMore: false }
        : { transcript: [{ text: "First", speaker: { name: "Joseph" } }], hasMore: true, cursor: "next" })
    }
    return Response.json({ id: "note-1", title: "Meeting" })
  }
  const client = new GranolaClient("grn_test", fetcher as typeof fetch, "https://example.test/v1")
  const note = await client.getNote("note-1")
  assert.equal(note.transcript?.length, 2)
  assert.equal(formatGranolaTranscript(note.transcript), "Joseph: First\n\nTyler: Second")
})

test("formatGranolaTranscript drops empty segments and preserves attribution", () => {
  assert.equal(formatGranolaTranscript([
    { text: "  " },
    { text: "Hello", speaker: { attribution: "me" } },
  ]), "me: Hello")
})
