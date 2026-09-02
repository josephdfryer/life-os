import { db } from "@/lib/db"
import { storeFile } from "@/lib/file-storage"
import { badRequest } from "@/server/api/errors"
import type { ImportedPerson } from "@/types"
import { auditAction, type DomainActor } from "./audit"
import { createEvent, parseTimestamp } from "./events"
import { createInteraction } from "./interactions"
import { createPerson } from "./persons"
import { runRulesForTarget } from "./rules"
import { autoDedupePersons } from "./merge"

type ImportFileInput = {
  name: string
  format: string
  content: string
}

type PersistOptions = {
  importedFileId?: string | null
  fileData?: ImportFileInput | null
  actor?: DomainActor
}

export type PersistedImportPerson = {
  action: "matched" | "created"
  personId: string
  name: string
  interactionCount: number
}

export async function confirmImport(results: ImportedPerson[], workspaceId: string, options: PersistOptions = {}) {
  if (!Array.isArray(results)) throw badRequest("results must be an array", { field: "results" })

  // Force the actor's workspace to the trusted, caller-supplied workspaceId —
  // never trust an actor object's own workspaceId for this write path.
  const actor: DomainActor | undefined = options.actor ? { ...options.actor, workspaceId } : undefined

  let importedFileId = options.importedFileId ?? null
  if (!importedFileId && options.fileData) {
    const importedFile = await storeFile(options.fileData.name, options.fileData.format, options.fileData.content, workspaceId)
    importedFileId = importedFile.id
  }

  const created: PersistedImportPerson[] = []
  for (const result of results) {
    const { personId, action } = await resolveImportedPerson(result, workspaceId, actor)
    await runRulesForTarget({
      trigger: "import.person",
      targetType: "person",
      targetId: personId,
      payload: {
        personId,
        action,
        name: result.name,
        matchedPersonId: result.matchedPersonId,
        isNew: result.isNew,
        guessedHeadline: result.guessedHeadline,
        guessedTags: result.guessedTags,
        importedFileId,
      },
      actor,
    })
    let interactionCount = 0

    for (const interaction of result.interactions ?? []) {
      const timestamp = parseImportDate(interaction.date)
      const event = await createEvent({
        name: interaction.summary?.slice(0, 80) || `${interaction.eventType} with ${result.name}`,
        type: interaction.eventType,
        timestamp,
      }, actor)

      const createdInteraction = await createInteraction({
        personId,
        eventId: event.id,
        type: interaction.eventType,
        timestamp,
        summary: interaction.summary,
        emotionalWeight: interaction.emotionalWeight,
        outcome: interaction.outcome,
        actionItems: interaction.keyTopics,
        sourceFileId: importedFileId,
      }, actor)
      await runRulesForTarget({
        trigger: "import.interaction",
        targetType: "interaction",
        targetId: createdInteraction.id,
        payload: {
          interactionId: createdInteraction.id,
          personId,
          personName: result.name,
          eventId: event.id,
          type: interaction.eventType,
          timestamp: timestamp.toISOString(),
          summary: interaction.summary,
          emotionalWeight: interaction.emotionalWeight,
          outcome: interaction.outcome,
          keyTopics: interaction.keyTopics,
          importedFileId,
        },
        actor,
      })
      interactionCount++
    }

    created.push({ action, personId, name: result.name, interactionCount })
  }

  await auditAction({
    actor,
    action: "import.confirm",
    targetType: "import",
    targetId: importedFileId,
    metadata: {
      persons: created.length,
      interactions: created.reduce((sum, person) => sum + person.interactionCount, 0),
    },
  })

  // Import is exactly when duplicate contacts get introduced — run the
  // workspace's auto-merge sweep right after, if it's opted in. Never lets
  // a slow or failing dedupe pass fail the import itself; it already has
  // its own time budget and partial-progress handling for large workspaces.
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { autoMergeEnabled: true } })
  if (workspace?.autoMergeEnabled) {
    await autoDedupePersons(workspaceId, actor).catch(error => {
      console.error("[import] auto-merge sweep failed", error)
    })
  }

  return { importedFileId, created }
}

async function resolveImportedPerson(result: ImportedPerson, workspaceId: string, actor?: DomainActor) {
  if (result.matchedPersonId) {
    const existing = await db.person.findFirst({ where: { id: result.matchedPersonId, workspaceId }, select: { id: true } })
    if (existing) return { personId: existing.id, action: "matched" as const }
  }

  if (!result.isNew) {
    const { first, last } = splitName(result.name)
    const existing = await db.person.findFirst({
      where: { first: { equals: first }, last: { equals: last }, workspaceId },
      select: { id: true },
    })
    if (existing) return { personId: existing.id, action: "matched" as const }
  }

  const { first, last } = splitName(result.name)
  const person = await createPerson({
    first,
    last: last || "—",
    title: result.guessedHeadline,
    headline: result.guessedHeadline,
    closeness: result.guessedCloseness ?? 1,
    tags: result.guessedTags ?? [],
    values: [],
    source: "interaction_import",
  }, actor) as { id: string }

  return { personId: person.id, action: "created" as const }
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return {
    first: parts[0] || name.trim() || "Unknown",
    last: parts.slice(1).join(" "),
  }
}

function parseImportDate(value: string) {
  if (!value) return new Date()
  if (!/(\d{4})-(\d{2})-(\d{2})/.test(value)) return new Date()
  return parseTimestamp(value)
}
