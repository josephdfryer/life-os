import { createRequire } from "node:module"
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

async function main() {
  // The guard stays — this deletes the file it is pointed at, so it must only
  // ever point inside the OS temp directory. The prefix is computed rather
  // than hard-coded, because "/private/tmp" is macOS-only and broke CI.
  const scratchPrefix = `file:${join(tmpdir(), "life-os-e2e")}`
  const databaseUrl = process.env.DATABASE_URL ?? `${scratchPrefix}.db`
  if (!databaseUrl.startsWith(scratchPrefix)) {
    throw new Error(`Refusing to prepare an E2E database outside ${scratchPrefix}*`)
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
    { id: "e2e-qin", workspaceId: "default-workspace", first: "Qin", last: "Fryer", closeness: 4 },
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
await db.stagedInteraction.create({
  data: {
    id: "e2e-whatsapp-qin",
    workspaceId: "default-workspace",
    source: "whatsapp",
    sourceId: "e2e-whatsapp-qin-source",
    status: "pending",
    itemType: "interaction",
    type: "message",
    timestamp: new Date("2026-07-15T14:00:00Z"),
    contactName: "Qin Fryer",
    contactPhone: "19175550000",
    summary: "A staged WhatsApp message for Qin",
    body: "A staged WhatsApp message for Qin",
    direction: "inbound",
  },
})
await db.rule.create({
  data: {
    id: "e2e-rule",
    workspaceId: "default-workspace",
    name: "Stage trusted messages",
    description: "A versioned E2E rule",
    trigger: "inbox.stage",
    mode: "dry_run",
    status: "active",
    priority: 10,
    version: 3,
    conditions: JSON.stringify([{ field: "source", operator: "equals", value: "e2e" }]),
    actions: JSON.stringify([{ type: "set_field", field: "priority", value: 2 }]),
    runs: {
      create: {
        id: "e2e-rule-run",
        workspaceId: "default-workspace",
        ruleVersion: 2,
        causationDepth: 1,
        trigger: "inbox.stage",
        targetType: "stagedInteraction",
        targetId: "e2e-staged",
        matched: true,
        mode: "dry_run",
        status: "planned",
        actionsPlanned: JSON.stringify([{ type: "set_field", field: "priority", value: 2 }]),
      },
    },
  },
})
await db.lifeModelSnapshot.create({
  data: {
    id: "e2e-life-model",
    workspaceId: "default-workspace",
    version: 1,
    summary: "One evidence-backed tension is visible in the test workspace.",
    status: "current",
    promptVersion: "e2e-v1",
    claims: {
      create: {
        id: "e2e-life-claim",
        kind: "tension",
        statement: "A declared relationship intention has gone quiet.",
        confidence: 1,
        subjectType: "Person",
        subjectId: "e2e-keeper",
        evidence: JSON.stringify([{ sourceType: "alignment_signal", sourceId: "relationship_gap", detail: { subject: "Merge Keeper", severity: 1.5 } }]),
      },
    },
  },
})
await db.graphEvent.create({
  data: {
    id: "e2e-graph-event",
    workspaceId: "default-workspace",
    occurredAt: new Date("2026-07-15T13:05:00Z"),
    recordedAt: new Date("2026-07-15T13:05:01Z"),
    subjectType: "Interaction",
    subjectId: "e2e-loser-interaction",
    eventType: "interaction.created",
    actorType: "system",
    sourceConnector: "e2e",
    idempotencyKey: "e2e:interaction.created:e2e-loser-interaction",
    payload: "{}",
    receipts: {
      create: {
        id: "e2e-graph-receipt",
        consumer: "automation",
        status: "failed",
        attempts: 2,
        lastError: "E2E consumer failure",
      },
    },
  },
})
await db.reviewItem.create({
  data: {
    id: "e2e-failed-review",
    workspaceId: "default-workspace",
    source: "e2e",
    sourceId: "e2e-failed-source",
    itemType: "interaction",
    proposedCommand: JSON.stringify({ command: "staged_interaction.accept", input: { stagedInteractionId: "e2e-staged" } }),
    status: "failed",
  },
})

  await db.$disconnect()
  console.log(`Prepared isolated E2E database at ${dbPath}`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
