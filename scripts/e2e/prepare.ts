import { createRequire } from "node:module"
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "file:/private/tmp/life-os-e2e.db"
  if (!databaseUrl.startsWith("file:/private/tmp/life-os-e2e")) {
    throw new Error("Refusing to prepare an E2E database outside /private/tmp/life-os-e2e*")
  }

  const dbPath = databaseUrl.slice("file:".length)
  if (existsSync(dbPath)) unlinkSync(dbPath)

  const require = createRequire(import.meta.url)
  const Database = require("better-sqlite3")
  const sqlite = new Database(dbPath)
  sqlite.pragma("foreign_keys = OFF")
  const migrationsDir = join(process.cwd(), "packages/db/prisma/migrations")
  for (const dirname of readdirSync(migrationsDir).filter(name => name !== "migration_lock.toml").sort()) {
    sqlite.exec(readFileSync(join(migrationsDir, dirname, "migration.sql"), "utf8"))
  }
  sqlite.pragma("foreign_keys = ON")
  sqlite.close()

  process.env.DATABASE_URL = databaseUrl
  process.env.TURSO_DATABASE_URL = ""
  process.env.TURSO_AUTH_TOKEN = ""

  const { db } = await import("@life-os/db")

  const owner = await db.user.create({
  data: { id: "e2e-owner", email: "e2e-owner@example.com", name: "E2E Owner", status: "active" },
})
await db.workspace.update({
  where: { id: "default-workspace" },
  data: { name: "E2E Life OS", slug: "e2e-life-os", ownerUserId: owner.id },
})
await db.workspaceMember.create({
  data: { workspaceId: "default-workspace", userId: owner.id, role: "owner", status: "active" },
})
await db.workspace.create({
  data: { id: "e2e-foreign-workspace", name: "Foreign", slug: "e2e-foreign" },
})

await db.person.createMany({
  data: [
    { id: "e2e-keeper", workspaceId: "default-workspace", first: "Merge", last: "Keeper" },
    { id: "e2e-loser", workspaceId: "default-workspace", first: "Merge", last: "Loser" },
    { id: "e2e-foreign-person", workspaceId: "e2e-foreign-workspace", first: "Foreign", last: "Person" },
  ],
})
await db.interaction.create({
  data: {
    id: "e2e-loser-interaction",
    workspaceId: "default-workspace",
    personId: "e2e-loser",
    type: "call",
    timestamp: new Date("2026-07-15T12:00:00Z"),
    summary: "Interaction that must survive merge",
  },
})
await db.stagedInteraction.create({
  data: {
    id: "e2e-staged",
    workspaceId: "default-workspace",
    source: "e2e",
    sourceId: "e2e-staged-source",
    status: "pending",
    itemType: "interaction",
    type: "message",
    timestamp: new Date("2026-07-15T13:00:00Z"),
    summary: "Staged interaction acceptance",
    candidatePersonId: "e2e-keeper",
  },
})

  await db.$disconnect()
  console.log(`Prepared isolated E2E database at ${dbPath}`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
