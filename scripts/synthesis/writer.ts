import type { PrismaClient } from "@life-os/db"
import type { ResolvedExtraction } from "./types"

const WORKSPACE_ID = process.env.SYNTHESIS_WORKSPACE_ID ?? "default-workspace"

export type WriteResult = {
  eventId: string
  interactionsCreated: number
  interactionsUpdated: number
  skipped: boolean
}

export async function writeExtraction(
  resolved: ResolvedExtraction,
  db: PrismaClient
): Promise<WriteResult> {
  const { event, participants, rawItem, resolvedPlaceIds, my_action_items } = resolved

  const synthMarker = `synthesis:${rawItem.source}:${rawItem.id}`

  // Idempotency: skip if already written
  const existing = await db.event.findFirst({
    where: { workspaceId: WORKSPACE_ID, metadata: { contains: synthMarker } },
    select: { id: true },
  })
  if (existing) return { eventId: existing.id, interactionsCreated: 0, interactionsUpdated: 0, skipped: true }

  // Only a "meeting" plausibly implies physical presence. A place merely
  // mentioned in a call/email/message thread ("remember when we went to
  // Nene") is not a visit — resolvedPlaceIds must never become an Event's
  // or Interaction's placeId for the other three types, or every text
  // reference to a place turns into a fabricated "visit" on that Place's
  // profile (and fabricates shared visits with whoever was in the thread).
  const placeId = event.type === "meeting" ? (resolvedPlaceIds[0] ?? null) : null

  return db.$transaction(async tx => {
    // Provenance: capture the raw item as a Note so every derived node can trace
    // back to the thing that produced it ("provenance is sacred").
    const note = await tx.note.create({
      data: {
        workspaceId: WORKSPACE_ID,
        timestamp: new Date(rawItem.timestamp),
        type: "import",
        content: rawItem.body,
        metadata: JSON.stringify({
          source: rawItem.source,
          sourceId: rawItem.id,
          archivePath: rawItem.archivePath ?? null,
          synthMarker,
        }),
      },
      select: { id: true },
    })

    const dbEvent = await tx.event.create({
      data: {
        workspaceId: WORKSPACE_ID,
        name: event.title,
        type: event.type,
        start: new Date(event.date),
        timestamp: new Date(event.date),
        sourceNoteId: note.id,
        placeId,
        notes: [event.notes, my_action_items?.length ? `My action items:\n${my_action_items.map(a => `- ${a.description}${a.deadline ? ` (by ${a.deadline})` : ""}`).join("\n")}` : null]
          .filter(Boolean)
          .join("\n\n") || null,
        metadata: JSON.stringify({
          source: rawItem.source,
          archivePath: rawItem.archivePath,
          synthMarker,
          placesMentioned: resolved.places_mentioned,
          plansMentioned: resolved.plans_mentioned,
        }),
      },
      select: { id: true },
    })

    let interactionsCreated = 0
    let interactionsUpdated = 0

    for (const participant of participants) {
      const actionItemsJson = participant.action_items?.length
        ? JSON.stringify(participant.action_items)
        : null

      if (participant.personId) {
        await tx.interaction.create({
          data: {
            workspaceId: WORKSPACE_ID,
            personId: participant.personId,
            eventId: dbEvent.id,
            placeId,
            sourceNoteId: note.id,
            type: event.type,
            timestamp: new Date(event.date),
            duration: event.duration_minutes ?? rawItem.durationSeconds ? Math.round((rawItem.durationSeconds ?? 0) / 60) : null,
            emotionalWeight: participant.emotional_weight != null ? String(participant.emotional_weight) : null,
            outcome: participant.outcomes?.join("; ") ?? null,
            summary: event.notes ?? null,
            actionItems: actionItemsJson,
            notes: synthMarker,
          },
        })
        interactionsCreated++
      } else {
        // Unknown participant — stage for review
        await tx.stagedInteraction.upsert({
          where: {
            workspaceId_source_sourceId: {
              workspaceId: WORKSPACE_ID,
              source: rawItem.source,
              sourceId: `${rawItem.id}:${participant.name}`,
            },
          },
          update: {},
          create: {
            workspaceId: WORKSPACE_ID,
            source: rawItem.source,
            sourceId: `${rawItem.id}:${participant.name}`,
            itemType: "interaction",
            status: "pending",
            contactName: participant.name,
            contactEmail: participant.email ?? null,
            contactPhone: participant.phone ?? null,
            type: event.type,
            timestamp: new Date(event.date),
            summary: event.notes ?? event.title,
            metadata: JSON.stringify({ eventId: dbEvent.id, synthMarker }),
          },
        })
        interactionsUpdated++
      }
    }

    return { eventId: dbEvent.id, interactionsCreated, interactionsUpdated, skipped: false }
  })
}
