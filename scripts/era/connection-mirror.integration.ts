import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { mirrorEraConnection } from "./connection-mirror"

async function main() {
  const workspaceId = "era-mirror-integration-workspace"
  const user = await db.user.create({ data: { email: "era-mirror@example.com" } })
  await db.workspace.create({
    data: {
      id: workspaceId,
      name: "Era mirror integration",
      slug: workspaceId,
      ownerUserId: user.id,
    },
  })
  const era = await db.eraConnection.create({
    data: {
      workspaceId,
      userId: user.id,
      status: "active",
      scope: "api-key",
      accessTokenEncrypted: "fixture-ciphertext",
    },
  })

  await db.$transaction(tx => mirrorEraConnection(tx, era))
  const first = await db.connection.findFirstOrThrow({
    where: { workspaceId, sourceTable: "EraConnection", sourceId: era.id },
  })
  assert.equal(first.kind, "era")
  assert.equal(first.provider, "era")
  assert.equal(first.accessTokenEncrypted, "fixture-ciphertext")

  const syncedAt = new Date()
  const updated = await db.eraConnection.update({
    where: { id: era.id },
    data: { syncCursor: "2026-08-08", lastSyncedAt: syncedAt },
  })
  await db.$transaction(tx => mirrorEraConnection(tx, updated))

  const rows = await db.connection.findMany({
    where: { workspaceId, sourceTable: "EraConnection", sourceId: era.id },
  })
  assert.equal(rows.length, 1, "refreshing a source row must update rather than duplicate its mirror")
  assert.equal(rows[0].lastSyncedAt?.getTime(), syncedAt.getTime())
  assert.deepEqual(JSON.parse(rows[0].metadata ?? "{}"), { syncCursor: "2026-08-08" })

  console.log("All Era connection mirror integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
