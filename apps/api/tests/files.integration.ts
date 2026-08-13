import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { db } from "@life-os/db"
import { GET as getFile } from "../app/v1/files/[id]/route"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceA = `files-api-a-${suffix}`
const workspaceB = `files-api-b-${suffix}`
const keyA = `lifeos_files_a_${suffix}`
let fileAId = ""
let fileBId = ""

test("files API: database content and workspace isolation", async () => {
  await db.workspace.createMany({ data: [
    { id: workspaceA, name: "Files API A", slug: workspaceA },
    { id: workspaceB, name: "Files API B", slug: workspaceB },
  ] })
  await createApiKey(workspaceA, keyA)
  const [fileA, fileB, emptyFile] = await Promise.all([
    db.importedFile.create({ data: {
      workspaceId: workspaceA, filename: "notes\"\r\n.txt", format: "txt", filePath: "db:file-a",
      sizeBytes: 12, content: "workspace-a", mimeType: "text/plain",
    } }),
    db.importedFile.create({ data: {
      workspaceId: workspaceB, filename: "secret.txt", format: "txt", filePath: "db:file-b",
      sizeBytes: 12, content: "workspace-b", mimeType: "text/plain",
    } }),
    db.importedFile.create({ data: {
      workspaceId: workspaceA, filename: "empty.txt", format: "txt", filePath: "db:empty",
      sizeBytes: 0, content: "", mimeType: "text/plain",
    } }),
  ])
  fileAId = fileA.id
  fileBId = fileB.id

  const ownResponse = await getFile(request(`http://localhost/v1/files/${fileAId}`, keyA), params(fileAId))
  assert.equal(ownResponse.status, 200)
  assert.equal(await ownResponse.text(), "workspace-a")
  assert.equal(ownResponse.headers.get("content-type"), "text/plain")
  assert.equal(ownResponse.headers.get("content-disposition"), 'attachment; filename="notes___.txt"')
  assert.equal(ownResponse.headers.get("x-content-type-options"), "nosniff")

  const emptyResponse = await getFile(request(`http://localhost/v1/files/${emptyFile.id}`, keyA), params(emptyFile.id))
  assert.equal(emptyResponse.status, 200)
  assert.equal(await emptyResponse.text(), "")

  const crossWorkspaceResponse = await getFile(request(`http://localhost/v1/files/${fileBId}`, keyA), params(fileBId))
  assert.equal(crossWorkspaceResponse.status, 404)
  assert.equal((await crossWorkspaceResponse.json()).error.code, "not_found")

  const missingResponse = await getFile(request("http://localhost/v1/files/missing", keyA), params("missing"))
  assert.equal(missingResponse.status, 404)
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceA } }).catch(() => undefined)
  await db.workspace.delete({ where: { id: workspaceB } }).catch(() => undefined)
  await db.$disconnect()
})

function request(url: string, key: string) {
  return new NextRequest(url, { headers: { "x-api-key": key } })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function createApiKey(workspaceId: string, rawKey: string) {
  return db.apiKey.create({ data: {
    workspaceId,
    name: `Files test ${workspaceId}`,
    keyPrefix: rawKey.slice(0, 20),
    keyHash: createHash("sha256").update(rawKey).digest("hex"),
    scopes: { create: { scope: "files.read" } },
  } })
}
