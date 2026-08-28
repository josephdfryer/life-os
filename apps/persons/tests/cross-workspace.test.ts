import test, { after } from "node:test"
import assert from "node:assert/strict"
import { createTestDatabase, type TestDatabase } from "@life-os/db/testing"

type TestModules = {
  db: typeof import("../lib/db")["db"]
  merge: typeof import("../server/domain/merge")
  fileStorage: typeof import("../lib/file-storage")
  importAnalysis: typeof import("../server/domain/import-analysis")
}

let modulesPromise: Promise<TestModules> | null = null
let testDb: TestDatabase | null = null

async function setup() {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      testDb = await createTestDatabase()
      const [dbModule, merge, fileStorage, importAnalysis] = await Promise.all([
        import("../lib/db"),
        import("../server/domain/merge"),
        import("../lib/file-storage"),
        import("../server/domain/import-analysis"),
      ])
      return { db: dbModule.db, merge, fileStorage, importAnalysis }
    })()
  }
  return modulesPromise
}

test("stored files require and enforce an explicit workspace", async () => {
  const { db, fileStorage } = await setup()
  await makeWorkspace(db, "ws-files-a")
  await makeWorkspace(db, "ws-files-b")

  const file = await fileStorage.storeFile("empty.txt", "txt", "", "ws-files-a")
  assert.equal(file.workspaceId, "ws-files-a")
  assert.deepEqual(await fileStorage.getFileContent(file.id, "ws-files-a"), {
    filename: "empty.txt",
    content: "",
    format: "txt",
  })
  assert.equal(await fileStorage.getFileContent(file.id, "ws-files-b"), null)
})

test("import analysis resolves each workspace's own owner name, never another's", async () => {
  const { db, importAnalysis } = await setup()
  await makeWorkspace(db, "ws-owner-a")
  await makeWorkspace(db, "ws-owner-b")

  const ownerPersonA = await makePerson(db, "ws-owner-a", "Ada", "Lovelace")
  const ownerUserA = await db.user.create({ data: { email: "ada@example.test", personId: ownerPersonA.id } })
  await db.workspace.update({ where: { id: "ws-owner-a" }, data: { ownerUserId: ownerUserA.id } })

  const ownerPersonB = await makePerson(db, "ws-owner-b", "Byron", "King")
  const ownerUserB = await db.user.create({ data: { email: "byron@example.test", personId: ownerPersonB.id } })
  await db.workspace.update({ where: { id: "ws-owner-b" }, data: { ownerUserId: ownerUserB.id } })

  assert.equal(await importAnalysis.resolveWorkspaceOwnerName("ws-owner-a"), "Ada Lovelace")
  assert.equal(await importAnalysis.resolveWorkspaceOwnerName("ws-owner-b"), "Byron King")

  // A workspace with no owner/membership resolved yet must not silently
  // borrow another workspace's name — it falls back to a generic label.
  await makeWorkspace(db, "ws-owner-none")
  assert.equal(await importAnalysis.resolveWorkspaceOwnerName("ws-owner-none"), "the workspace owner")
})

async function makeWorkspace(db: TestModules["db"], id: string) {
  return db.workspace.create({ data: { id, name: id, slug: id } })
}

async function makePerson(db: TestModules["db"], workspaceId: string, first: string, last = "Test") {
  return db.person.create({ data: { workspaceId, first, last } })
}

test("mergePersons rejects a target person from another workspace", async () => {
  const { db, merge } = await setup()
  await makeWorkspace(db, "ws-a-1")
  await makeWorkspace(db, "ws-b-1")
  const keeper = await makePerson(db, "ws-a-1", "Keeper")
  const intruder = await makePerson(db, "ws-b-1", "Intruder")

  await assert.rejects(
    () => merge.mergePersons({ keepId: keeper.id, deleteId: intruder.id }, "ws-a-1"),
    /not found/i,
  )

  // Neither record should have been touched.
  const stillThere = await db.person.findUnique({ where: { id: intruder.id } })
  assert.ok(stillThere, "workspace B person must not be deleted by a workspace A merge")
  const untouched = await db.person.findUnique({ where: { id: keeper.id } })
  assert.equal(untouched?.last, "Test")
})

test("mergePersonPairs rejects a batch containing a cross-workspace id", async () => {
  const { db, merge } = await setup()
  await makeWorkspace(db, "ws-a-2")
  await makeWorkspace(db, "ws-b-2")
  const keeper = await makePerson(db, "ws-a-2", "Keeper2")
  const intruder = await makePerson(db, "ws-b-2", "Intruder2")

  await assert.rejects(
    () => merge.mergePersonPairs([{ keepId: keeper.id, deleteId: intruder.id }], "ws-a-2"),
  )

  const stillThere = await db.person.findUnique({ where: { id: intruder.id } })
  assert.ok(stillThere)
})

test("mergePersonClusters rejects a cluster containing a cross-workspace id", async () => {
  const { db, merge } = await setup()
  await makeWorkspace(db, "ws-a-3")
  await makeWorkspace(db, "ws-b-3")
  const a = await makePerson(db, "ws-a-3", "A3")
  const b = await makePerson(db, "ws-b-3", "B3")

  await assert.rejects(
    () => merge.mergePersonClusters([{ aId: a.id, bId: b.id }], "ws-a-3"),
  )

  const stillThere = await db.person.findUnique({ where: { id: b.id } })
  assert.ok(stillThere)
})

test("findPersonDuplicates never returns another workspace's people", async () => {
  const { db, merge } = await setup()
  await makeWorkspace(db, "ws-a-4")
  await makeWorkspace(db, "ws-b-4")
  await makePerson(db, "ws-a-4", "Sameface")
  const otherWorkspacePerson = await makePerson(db, "ws-b-4", "Sameface")

  const duplicates = await merge.findPersonDuplicates("ws-a-4")
  const allIds = duplicates.flatMap(pair => [pair.a.id, pair.b.id])
  assert.ok(!allIds.includes(otherWorkspacePerson.id), "duplicate scan must not cross workspaces")
})

test("mergeSameEmailPersons never merges across workspaces even with a shared email", async () => {
  const { db, merge } = await setup()
  await makeWorkspace(db, "ws-a-5")
  await makeWorkspace(db, "ws-b-5")
  const a = await db.person.create({ data: { workspaceId: "ws-a-5", first: "Same", last: "Email", emails: JSON.stringify(["shared@example.com"]) } })
  const b = await db.person.create({ data: { workspaceId: "ws-b-5", first: "Same", last: "Email", emails: JSON.stringify(["shared@example.com"]) } })

  const result = await merge.mergeSameEmailPersons("ws-a-5")
  assert.equal(result.merged, 0)

  const bStillThere = await db.person.findUnique({ where: { id: b.id } })
  assert.ok(bStillThere, "workspace B person with the same email must survive a workspace A dedupe run")
  const aStillThere = await db.person.findUnique({ where: { id: a.id } })
  assert.ok(aStillThere)
})

test("mergePersons succeeds and reassigns records within the same workspace", async () => {
  const { db, merge } = await setup()
  await makeWorkspace(db, "ws-same-1")
  const keeper = await makePerson(db, "ws-same-1", "Keep")
  const loser = await makePerson(db, "ws-same-1", "Lose")
  await db.interaction.create({
    data: { workspaceId: "ws-same-1", personId: loser.id, type: "call", timestamp: new Date() },
  })

  const result = await merge.mergePersons({ keepId: keeper.id, deleteId: loser.id }, "ws-same-1")
  assert.equal(result.ok, true)

  const deleted = await db.person.findUnique({ where: { id: loser.id } })
  assert.equal(deleted, null)

  const reassigned = await db.interaction.findFirst({ where: { personId: keeper.id } })
  assert.ok(reassigned, "interaction should be reassigned to the keeper")
})

test("undoMerge recreates the deleted person, reverses reassignment, and cannot be replayed", async () => {
  const { db, merge } = await setup()
  await makeWorkspace(db, "ws-undo-1")
  const keeper = await makePerson(db, "ws-undo-1", "Keep")
  const loser = await makePerson(db, "ws-undo-1", "Lose", "Original")
  await db.person.update({ where: { id: loser.id }, data: { title: "Original Title", closeness: 3 } })
  const interaction = await db.interaction.create({
    data: { workspaceId: "ws-undo-1", personId: loser.id, type: "call", timestamp: new Date() },
  })

  await merge.mergePersons({ keepId: keeper.id, deleteId: loser.id }, "ws-undo-1")
  assert.equal(await db.person.findUnique({ where: { id: loser.id } }), null)

  const recent = await merge.listRecentMerges("ws-undo-1")
  const entry = recent.find(e => e.pending.some(p => p.deleteId === loser.id))
  assert.ok(entry, "the merge should appear in the recent-merges list with undo data")

  const { restoredId } = await merge.undoMerge(entry!.auditLogId, loser.id, "ws-undo-1")
  assert.equal(restoredId, loser.id)

  const restored = await db.person.findUnique({ where: { id: loser.id } })
  assert.ok(restored, "the deleted person should be recreated with the same id")
  assert.equal(restored?.first, "Lose")
  assert.equal(restored?.title, "Original Title")
  assert.equal(restored?.closeness, 3)

  const movedBack = await db.interaction.findUnique({ where: { id: interaction.id } })
  assert.equal(movedBack?.personId, loser.id, "the reassigned interaction should move back to the restored person")

  // The snapshot is consumed on undo — replaying the same undo must fail
  // rather than silently succeed a second time.
  await assert.rejects(() => merge.undoMerge(entry!.auditLogId, loser.id, "ws-undo-1"))

  const recentAfterUndo = await merge.listRecentMerges("ws-undo-1")
  assert.ok(
    !recentAfterUndo.some(e => e.auditLogId === entry!.auditLogId && e.pending.some(p => p.deleteId === loser.id)),
    "an undone person should no longer be offered for undo",
  )
})

test("undoMerge rejects a merge record from another workspace", async () => {
  const { db, merge } = await setup()
  await makeWorkspace(db, "ws-undo-a")
  await makeWorkspace(db, "ws-undo-b")
  const keeper = await makePerson(db, "ws-undo-a", "Keep")
  const loser = await makePerson(db, "ws-undo-a", "Lose")
  await merge.mergePersons({ keepId: keeper.id, deleteId: loser.id }, "ws-undo-a")

  const recent = await merge.listRecentMerges("ws-undo-a")
  const entry = recent.find(e => e.pending.some(p => p.deleteId === loser.id))
  assert.ok(entry)

  await assert.rejects(() => merge.undoMerge(entry!.auditLogId, loser.id, "ws-undo-b"))
})
