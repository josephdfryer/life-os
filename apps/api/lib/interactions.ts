import { interactionResourceContract, type InteractionResource } from "@life-os/contracts"
import { db } from "@life-os/db"
import { InteractionError } from "@life-os/domain"

type InteractionRow = NonNullable<Awaited<ReturnType<typeof findInteractionRow>>>

export async function findInteractionRow(id: string, workspaceId: string) {
  return db.interaction.findFirst({
    where: { id, workspaceId },
    include: {
      event: { select: { id: true, name: true, type: true } },
      sourceFile: { select: { id: true, filename: true } },
    },
  })
}

export async function getInteractionResource(id: string, workspaceId: string) {
  const interaction = await findInteractionRow(id, workspaceId)
  if (!interaction) throw new InteractionError("Interaction not found", "not_found")
  return formatInteractionResource(interaction)
}

export function formatInteractionResource(interaction: InteractionRow): InteractionResource {
  return interactionResourceContract.parse({
    id: interaction.id,
    createdAt: interaction.createdAt.toISOString(),
    personId: interaction.personId,
    eventId: interaction.eventId,
    type: interaction.type,
    timestamp: interaction.timestamp.toISOString(),
    duration: interaction.duration,
    emotionalWeight: interaction.emotionalWeight,
    outcome: interaction.outcome,
    summary: interaction.summary,
    notes: interaction.notes,
    actionItems: storedStringList(interaction.actionItems),
    billable: interaction.billable,
    amountCents: interaction.amount,
    direction: interaction.direction,
    sourceFileId: interaction.sourceFileId,
    source: interaction.source,
    sourceId: interaction.sourceId,
    subtype: interaction.subtype,
    currency: interaction.currency,
    category: interaction.category,
    merchantName: interaction.merchantName,
    actorPersonId: interaction.actorPersonId,
    sourceNoteId: interaction.sourceNoteId,
    metadata: storedMetadata(interaction.metadata),
    event: interaction.event
      ? { id: interaction.event.id, name: interaction.event.name, type: interaction.event.type }
      : null,
    file: interaction.sourceFile
      ? { id: interaction.sourceFile.id, filename: interaction.sourceFile.filename, retrieveUrl: `/v1/files/${interaction.sourceFile.id}` }
      : null,
  })
}

function storedStringList(raw: string | null) {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return raw.split(" ::: ").map(item => item.trim()).filter(Boolean)
  }
}

function storedMetadata(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return raw }
}
