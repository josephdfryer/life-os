import { db } from "@/lib/db"
import { storeFile } from "@/lib/file-storage"
import { badRequest } from "@/server/api/errors"
import type { ImportedPerson } from "@/types"
import { auditAction, type DomainActor } from "./audit"
import { createEvent, parseTimestamp } from "./events"
import { createInteraction } from "./interactions"
import { createPerson } from "./people"

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

export async function confirmImport(results: ImportedPerson[], options: PersistOptions = {}) {
  if (!Array.isArray(results)) throw badRequest("results must be an array", { field: "results" })

  let importedFileId = options.importedFileId ?? null
  if (!importedFileId && options.fileData) {
    const importedFile = await storeFile(options.fileData.name, options.fileData.format, options.fileData.content)
    importedFileId = importedFile.id
  }

  const created: PersistedImportPerson[] = []
  for (const result of results) {
    const { personId, action } = await resolveImportedPerson(result, options.actor)
    let interactionCount = 0

    for (const interaction of result.interactions ?? []) {
      const timestamp = parseImportDate(interaction.date)
      const event = await createEvent({
        name: interaction.summary?.slice(0, 80) || `${interaction.eventType} with ${result.name}`,
        type: interaction.eventType,
        timestamp,
      }, options.actor)

      await createInteraction({
        personId,
        eventId: event.id,
        type: interaction.eventType,
        timestamp,
        summary: interaction.summary,
        emotionalWeight: interaction.emotionalWeight,
        outcome: interaction.outcome,
        actionItems: interaction.keyTopics,
        sourceFileId: importedFileId,
      }, options.actor)
      interactionCount++
    }

    created.push({ action, personId, name: result.name, interactionCount })
  }

  await auditAction({
    actor: options.actor,
    action: "import.confirm",
    targetType: "import",
    targetId: importedFileId,
    metadata: {
      persons: created.length,
      interactions: created.reduce((sum, person) => sum + person.interactionCount, 0),
    },
  })

  return { importedFileId, created }
}

async function resolveImportedPerson(result: ImportedPerson, actor?: DomainActor) {
  if (result.matchedPersonId) {
    const existing = await db.person.findUnique({ where: { id: result.matchedPersonId }, select: { id: true } })
    if (existing) return { personId: existing.id, action: "matched" as const }
  }

  if (!result.isNew) {
    const { first, last } = splitName(result.name)
    const existing = await db.person.findFirst({
      where: { first: { equals: first }, last: { equals: last } },
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
    closeness: result.guessedCloseness ?? 2,
    tags: result.guessedTags ?? [],
    values: [],
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
