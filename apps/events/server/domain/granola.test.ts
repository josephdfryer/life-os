import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import Database from "better-sqlite3"

test("Granola import is idempotent, preserves user context, links exact emails and stages unknown people", async () => {
  const directory = mkdtempSync(join(tmpdir(), "life-os-granola-test-"))
  const databasePath = join(directory, "test.db")
  const sqlite = new Database(databasePath)
  const migrationsRoot = join(process.cwd(), "../../packages/db/prisma/migrations")
  for (const name of readdirSync(migrationsRoot).filter(name => name !== "migration_lock.toml").sort()) {
    sqlite.exec(readFileSync(join(migrationsRoot, name, "migration.sql"), "utf8"))
  }
  sqlite.close()

  process.env.DATABASE_URL = `file:${databasePath}`
  process.env.TURSO_DATABASE_URL = ""
  process.env.TURSO_AUTH_TOKEN = ""
  const [{ db }, { importGranolaNote }] = await Promise.all([
    import("@life-os/db"),
    import("./granola"),
  ])

  try {
    const workspace = await db.workspace.create({ data: { name: "Test", slug: `granola-${Date.now()}` } })
    const connection = await db.connection.create({ data: {
      workspaceId: workspace.id, kind: "meetings", provider: "granola", status: "active", label: "Fixture",
    } })
    const [joseph, tyler] = await Promise.all([
      db.person.create({ data: { workspaceId: workspace.id, first: "Joseph", last: "Fryer", emails: JSON.stringify(["joseph@example.com"]) } }),
      db.person.create({ data: { workspaceId: workspace.id, first: "Tyler", last: "Fishback", emails: JSON.stringify(["tyler@example.com"]) } }),
    ])
    const group = await db.group.create({ data: { workspaceId: workspace.id, name: "Sight Machine", groupType: "employer" } })
    await db.personGroup.createMany({ data: [
      { personId: joseph.id, groupId: group.id },
      { personId: tyler.id, groupId: group.id },
    ] })

    const note = {
      id: "note-fixture",
      title: "Vertical readiness logic sync",
      created_at: "2026-08-14T16:00:00.000Z",
      updated_at: "2026-08-14T17:00:00.000Z",
      web_url: "https://app.granola.ai/notes/note-fixture",
      summary_markdown: "Initial provider summary",
      calendar_event: {
        scheduled_start_time: "2026-08-14T16:00:00.000Z",
        scheduled_end_time: "2026-08-14T16:30:00.000Z",
      },
      attendees: [
        { name: "Joseph Fryer", email: "JOSEPH@example.com" },
        { name: "Tyler Fishback", email: "tyler@example.com" },
        { name: "Unknown Person", email: "unknown@example.com" },
      ],
      transcript: [{ text: "A complete thought.", speaker: { name: "Joseph" } }],
    }

    const first = await importGranolaNote({ workspaceId: workspace.id, connectionId: connection.id, note })
    await db.event.update({ where: { id: first.eventId }, data: { notes: "User-authored context" } })
    const second = await importGranolaNote({
      workspaceId: workspace.id,
      connectionId: connection.id,
      note: { ...note, updated_at: "2026-08-14T18:00:00.000Z", summary_markdown: "Edited provider summary" },
    })

    assert.equal(second.eventId, first.eventId)
    assert.equal(await db.event.count({ where: { workspaceId: workspace.id } }), 1)
    assert.equal(await db.interaction.count({ where: { workspaceId: workspace.id, source: "granola" } }), 2)
    assert.equal(await db.stagedInteraction.count({ where: { workspaceId: workspace.id, source: "granola" } }), 1)
    assert.equal(await db.reviewItem.count({ where: { workspaceId: workspace.id, source: "staged_interaction" } }), 1)
    assert.equal(await db.granolaNoteLink.count({ where: { workspaceId: workspace.id } }), 1)

    const event = await db.event.findUniqueOrThrow({ where: { id: first.eventId }, include: { groupTags: true } })
    assert.equal(event.notes, "User-authored context")
    assert.match(event.transcript ?? "", /Joseph: A complete thought/)
    assert.match(event.metadata ?? "", /Edited provider summary/)
    assert.deepEqual(event.groupTags.map(row => row.id), [group.id])
  } finally {
    await db.$disconnect()
    rmSync(directory, { recursive: true, force: true })
  }
})
