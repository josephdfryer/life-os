import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { notesPageContract, noteResourceContract } from "@life-os/contracts"
import { db } from "@life-os/db"
import { GET as listNotes, POST as createNote } from "../app/v1/notes/route"
import { GET as getNote } from "../app/v1/notes/[id]/route"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceA = `notes-api-a-${suffix}`
const workspaceB = `notes-api-b-${suffix}`
const keyA = `lifeos_notes_a_${suffix}`
const keyB = `lifeos_notes_b_${suffix}`
let personAId = ""
let personBId = ""
let noteBId = ""

test("notes API: subject edges, cursor pagination, and workspace isolation", async () => {
  await db.workspace.createMany({ data: [
    { id: workspaceA, name: "Notes API A", slug: workspaceA },
    { id: workspaceB, name: "Notes API B", slug: workspaceB },
  ] })
  const [personA, personB] = await Promise.all([
    db.person.create({ data: { workspaceId: workspaceA, first: "Qin", last: "Subject" } }),
    db.person.create({ data: { workspaceId: workspaceB, first: "Other", last: "Tenant" } }),
  ])
  personAId = personA.id
  personBId = personB.id
  const noteB = await db.note.create({
    data: {
      workspaceId: workspaceB,
      timestamp: new Date(),
      type: "thought",
      content: "Other workspace note",
      aboutPersonId: personBId,
    },
  })
  noteBId = noteB.id
  await Promise.all([
    createApiKey(workspaceA, keyA, ["notes.read", "notes.write"]),
    createApiKey(workspaceB, keyB, ["notes.read", "notes.write"]),
  ])

  const createdResponse = await createNote(request("http://localhost/v1/notes", keyA, {
    method: "POST",
    body: JSON.stringify({
      content: "Qin seemed tired today",
      type: "observation",
      aboutPersonId: personAId,
    }),
  }))
  assert.equal(createdResponse.status, 201)
  const created = noteResourceContract.parse(await createdResponse.json())
  assert.equal(created.content, "Qin seemed tired today")
  assert.equal(created.type, "observation")
  assert.equal(created.aboutPersonId, personAId)
  assert.equal((await db.note.findUniqueOrThrow({ where: { id: created.id } })).workspaceId, workspaceA)

  const crossPersonCreate = await createNote(request("http://localhost/v1/notes", keyA, {
    method: "POST",
    body: JSON.stringify({ content: "Must not link", aboutPersonId: personBId }),
  }))
  assert.equal(crossPersonCreate.status, 404)

  const pageOneResponse = await listNotes(request("http://localhost/v1/notes?limit=1", keyA))
  assert.equal(pageOneResponse.status, 200)
  const pageOne = notesPageContract.parse(await pageOneResponse.json())
  assert.equal(pageOne.data.length, 1)
  assert.equal(pageOne.data[0].id, created.id)

  const filtered = notesPageContract.parse(await (await listNotes(request(
    `http://localhost/v1/notes?personId=${encodeURIComponent(personAId)}`,
    keyA,
  ))).json())
  assert.equal(filtered.data.length, 1)
  assert.equal(filtered.data[0].aboutPersonId, personAId)

  const crossWorkspaceRead = await getNote(request(`http://localhost/v1/notes/${noteBId}`, keyA), params(noteBId))
  assert.equal(crossWorkspaceRead.status, 404)
  assert.equal((await crossWorkspaceRead.json()).error.code, "not_found")

  const ownRead = await getNote(request(`http://localhost/v1/notes/${created.id}`, keyA), params(created.id))
  assert.equal(ownRead.status, 200)
  assert.equal(noteResourceContract.parse(await ownRead.json()).aboutPersonId, personAId)

  const otherWorkspaceList = notesPageContract.parse(await (await listNotes(request("http://localhost/v1/notes", keyB))).json())
  assert.deepEqual(otherWorkspaceList.data.map(note => note.id), [noteBId])
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceA } }).catch(() => undefined)
  await db.workspace.delete({ where: { id: workspaceB } }).catch(() => undefined)
  await db.$disconnect()
})

function request(url: string, key: string, init?: { method?: string; body?: string }) {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: { "x-api-key": key, "content-type": "application/json" },
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function createApiKey(workspaceId: string, rawKey: string, scopes: string[]) {
  return db.apiKey.create({ data: {
    workspaceId,
    name: `Notes test ${workspaceId}`,
    keyPrefix: rawKey.slice(0, 20),
    keyHash: createHash("sha256").update(rawKey).digest("hex"),
    scopes: { create: scopes.map(scope => ({ scope })) },
  } })
}
