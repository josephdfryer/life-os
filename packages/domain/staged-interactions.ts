import type { Prisma } from "@life-os/db"
import { publishGraphEvent, type GraphEventActor } from "./events"
import { writeAuditLog, type AuditActor } from "./audit"
import { syncReviewItemStatus, registerReviewCommand, registerReviewDismiss } from "./review"

// The shared write behind "a message/email/transaction became a canonical
// Interaction" — whether that happens because a rule auto-approved a staged
// item, or a human accepted one in a review queue.
//
// This used to exist twice: apps/persons/server/domain/interactions.ts's
// appendDailySourceInteraction, and a full independent re-implementation in
// apps/home/app/api/communications/[id]/route.ts's acceptCommunication. The
// two had already drifted — Home's no-event source list was missing "gmail",
// so it created an Event for gmail-sourced accepts that Persons never would
// have. One shared command removes the category of bug, not just this
// instance of it.

const DAY_TIME_ZONE = "America/Los_Angeles"
// Sources whose provider already supplies enough temporal/thread context that
// a separate Event node would be redundant bookkeeping, not a real occurrence.
const NO_EVENT_SOURCES = new Set(["imessage", "gmail", "whatsapp"])

export function normalizeSourceMarker(source: string, sourceId: string) {
  return `${source}:${sourceId}`
}

export function sourceMarkers(notes: string | null | undefined) {
  return (notes ?? "")
    .split(/\s+/)
    .map(part => part.trim())
    .filter(part => /^[a-z0-9_-]+:.+/i.test(part))
}

export function appendUniqueLine(existing: string | null | undefined, next: string) {
  const clean = existing?.trim()
  if (!clean) return next
  if (clean.split(/\n+/).map(line => line.trim()).includes(next.trim())) return clean
  return `${clean}\n${next}`
}

export async function findInteractionByExactSource(
  client: Prisma.TransactionClient,
  source: string,
  sourceId: string,
  personId?: string | null,
  workspaceId = "default-workspace",
) {
  const sourced = await client.interaction.findUnique({
    where: { workspaceId_source_sourceId: { workspaceId, source, sourceId } },
    select: { id: true, notes: true },
  })
  if (sourced) return sourced
  const marker = normalizeSourceMarker(source, sourceId)
  const candidates = await client.interaction.findMany({
    where: {
      ...(personId ? { personId } : {}),
      workspaceId,
      notes: { contains: marker },
    },
    select: { id: true, notes: true },
    take: 20,
  })
  return candidates.find(candidate => sourceMarkers(candidate.notes).includes(marker)) ?? null
}

function dayKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DAY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function messageLine(timestamp: Date, direction: string | null | undefined, summary: string) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: DAY_TIME_ZONE, hour: "numeric", minute: "2-digit",
  }).format(timestamp)
  return `[${time}${direction ? ` ${direction}` : ""}] ${summary}`
}

async function writeInteractionParticipants(
  tx: Prisma.TransactionClient,
  interactionId: string,
  fields: { personId?: string | null; eventId?: string | null },
  workspaceId: string,
) {
  const rows: { entityType: string; entityId: string }[] = []
  if (fields.personId) rows.push({ entityType: "Person", entityId: fields.personId })
  if (fields.eventId) rows.push({ entityType: "Event", entityId: fields.eventId })
  if (!rows.length) return
  await tx.interactionParticipant.createMany({
    data: rows.map(row => ({ ...row, interactionId, workspaceId })),
  })
}

export type AppendDailySourceInteractionInput = {
  personId: string
  source: string
  sourceId: string
  type: string
  timestamp: Date
  summary: string
  body?: string | null
  direction?: string | null
  // When a source already created the canonical occurrence (for example a
  // Granola meeting), attach the accepted identity to that Event instead of
  // inventing a source-day Event.
  eventId?: string | null
  workspaceId?: string
  actor?: GraphEventActor & AuditActor
}

export type AppendDailySourceInteractionResult = {
  interactionId: string
  created: boolean
  updated: boolean
}

/**
 * Write or append-to-today's Interaction for a source record, transactionally
 * with its GraphEvent. Opens its own transaction — use
 * `appendDailySourceInteractionTx` directly when composing into a larger one
 * (see `acceptStagedInteraction` below, which must flip the StagedInteraction
 * status in the SAME transaction as the Interaction write).
 */
export async function appendDailySourceInteraction(
  input: AppendDailySourceInteractionInput,
): Promise<AppendDailySourceInteractionResult> {
  const { db } = await import("@life-os/db")
  return db.$transaction(tx => appendDailySourceInteractionTx(tx, input), { timeout: 20_000, maxWait: 10_000 })
}

export async function appendDailySourceInteractionTx(
  tx: Prisma.TransactionClient,
  input: AppendDailySourceInteractionInput,
): Promise<AppendDailySourceInteractionResult> {
  const workspaceId = input.workspaceId ?? "default-workspace"

  const existingSource = await findInteractionByExactSource(tx, input.source, input.sourceId, input.personId, workspaceId)
  if (existingSource) return { interactionId: existingSource.id, created: false, updated: false }

  const dayMarker = `${input.source}-day:${dayKey(input.timestamp)}`
  const sourceMarker = normalizeSourceMarker(input.source, input.sourceId)
  // Preserve the actual communication when the provider supplied it. The AI
  // summary remains a fallback, not a replacement for the relationship record.
  const line = messageLine(input.timestamp, input.direction, input.body || input.summary || "(no text)")

  if (input.eventId) {
    const event = await tx.event.findFirst({ where: { id: input.eventId, workspaceId }, select: { id: true } })
    if (!event) throw new Error("The source Event does not exist in this workspace")
    const interaction = await tx.interaction.create({
      data: {
        personId: input.personId,
        workspaceId,
        eventId: event.id,
        type: input.type,
        timestamp: input.timestamp,
        summary: input.summary,
        notes: sourceMarker,
        direction: input.direction ?? null,
        source: input.source,
        sourceId: input.sourceId,
      },
      select: { id: true },
    })
    await writeInteractionParticipants(tx, interaction.id, { personId: input.personId, eventId: event.id }, workspaceId)
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Interaction",
      subjectId: interaction.id,
      eventType: "interaction.created",
      actor: input.actor,
      sourceConnector: input.source,
      idempotencyKey: `interaction-create:${sourceMarker}`,
      payload: { interactionId: interaction.id, personId: input.personId, eventId: event.id, source: input.source, sourceId: input.sourceId, mode: "create" },
      provenance: { source: input.source, sourceId: input.sourceId, eventId: event.id },
    })
    return { interactionId: interaction.id, created: true, updated: false }
  }

  const dailyInteraction = await tx.interaction.findFirst({
    where: { personId: input.personId, workspaceId, type: input.type, notes: { contains: dayMarker } },
    select: { id: true, summary: true, notes: true, direction: true },
    orderBy: { timestamp: "asc" },
  })

  if (dailyInteraction) {
    const interaction = await tx.interaction.update({
      where: { id: dailyInteraction.id },
      data: {
        summary: appendUniqueLine(dailyInteraction.summary, line),
        notes: appendUniqueLine(dailyInteraction.notes, sourceMarker),
        direction: dailyInteraction.direction === input.direction ? dailyInteraction.direction : "mixed",
      },
      select: { id: true },
    })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Interaction",
      subjectId: interaction.id,
      eventType: "interaction.appended",
      actor: input.actor,
      sourceConnector: input.source,
      // A unique key per (day-bucket append, source record) — the same
      // source record can only append to a given day's Interaction once.
      idempotencyKey: `interaction-append:${sourceMarker}:${dayMarker}`,
      payload: { interactionId: interaction.id, personId: input.personId, source: input.source, sourceId: input.sourceId, mode: "append" },
      provenance: { source: input.source, sourceId: input.sourceId },
    })
    return { interactionId: interaction.id, created: false, updated: true }
  }

  const event = NO_EVENT_SOURCES.has(input.source)
    ? null
    : await tx.event.create({
      data: {
        name: `${input.source} ${dayKey(input.timestamp)}`.slice(0, 80),
        workspaceId,
        type: input.type,
        start: input.timestamp,
        timestamp: input.timestamp,
        metadata: JSON.stringify({ source: input.source, day: dayKey(input.timestamp) }),
      },
      select: { id: true },
    })

  const interaction = await tx.interaction.create({
    data: {
      personId: input.personId,
      workspaceId,
      eventId: event?.id ?? null,
      type: input.type,
      timestamp: input.timestamp,
      summary: line,
      notes: `${dayMarker}\n${sourceMarker}`,
      direction: input.direction ?? null,
    },
    select: { id: true },
  })
  await writeInteractionParticipants(tx, interaction.id, { personId: input.personId, eventId: event?.id ?? null }, workspaceId)
  await publishGraphEvent(tx, {
    workspaceId,
    subjectType: "Interaction",
    subjectId: interaction.id,
    eventType: "interaction.created",
    actor: input.actor,
    sourceConnector: input.source,
    idempotencyKey: `interaction-create:${sourceMarker}`,
    payload: { interactionId: interaction.id, personId: input.personId, source: input.source, sourceId: input.sourceId, mode: "create" },
    provenance: { source: input.source, sourceId: input.sourceId },
  })
  return { interactionId: interaction.id, created: true, updated: false }
}

// ── acceptStagedInteraction — the first shared command ─────────────────────
//
// Unifies apps/persons/server/domain/inbox.ts's acceptInboxItem/completeAccept
// with apps/home's acceptCommunication. Both Persons and Home call this; the
// duplicate implementation in apps/home/app/api/communications/[id]/route.ts
// is removed once Home switches over (tracked as Track B's B3 in
// ~/.claude/plans/serialized-bubbling-pearl.md).
//
// Idempotent: accepting an already-accepted item returns the existing result
// rather than erroring or double-writing — same contract as
// packages/domain/note-suggestions.ts's reviewNoteSuggestion.

export class AcceptStagedInteractionError extends Error {
  code: "not_found" | "invalid_state" | "validation"
  constructor(message: string, code: "not_found" | "invalid_state" | "validation") {
    super(message)
    this.name = "AcceptStagedInteractionError"
    this.code = code
  }
}

export type AcceptStagedInteractionInput = {
  id: string
  workspaceId?: string
  personId?: string | null
  summary?: string | null
  direction?: string | null
  timestamp?: Date | string | null
  actor?: GraphEventActor & AuditActor
}

export type AcceptStagedInteractionResult = {
  status: "accepted"
  interactionId: string
  created: boolean
}

export async function acceptStagedInteraction(
  input: AcceptStagedInteractionInput,
): Promise<AcceptStagedInteractionResult> {
  const { db } = await import("@life-os/db")
  const workspaceId = input.workspaceId ?? input.actor?.workspaceId ?? "default-workspace"

  const item = await db.stagedInteraction.findFirst({ where: { id: input.id, workspaceId } })
  if (!item) throw new AcceptStagedInteractionError("Staged interaction not found", "not_found")

  // Idempotent: a retried accept (network retry, double-click, a second
  // consumer racing the same event) returns the prior result rather than
  // erroring or writing a second Interaction.
  if (item.status === "accepted") {
    if (!item.interactionId) {
      throw new AcceptStagedInteractionError("Item is marked accepted but has no interactionId", "invalid_state")
    }
    return { status: "accepted", interactionId: item.interactionId, created: false }
  }
  if (item.status !== "pending" && item.status !== "blocked") {
    throw new AcceptStagedInteractionError(`Cannot accept an item with status "${item.status}"`, "invalid_state")
  }

  const personId = input.personId ?? item.candidatePersonId
  if (!personId) throw new AcceptStagedInteractionError("Choose a Person before accepting this item", "validation")

  const person = await db.person.findFirst({ where: { id: personId, workspaceId }, select: { id: true } })
  if (!person) throw new AcceptStagedInteractionError("Selected Person does not exist", "not_found")

  const summary = input.summary ?? item.summary
  const timestamp = input.timestamp ? new Date(input.timestamp) : item.timestamp
  if (Number.isNaN(timestamp.getTime())) throw new AcceptStagedInteractionError("timestamp is invalid", "validation")
  const direction = input.direction ?? item.direction
  const sourceMetadata = parseSourceMetadata(item.metadata)

  const result = await db.$transaction(async tx => {
    const written = await appendDailySourceInteractionTx(tx, {
      personId,
      source: item.source,
      sourceId: item.sourceId,
      type: item.type,
      timestamp,
      summary: summary || item.body || "(no text)",
      body: item.body,
      direction,
      eventId: sourceMetadata.eventId,
      workspaceId,
      actor: input.actor,
    })

    await tx.stagedInteraction.update({
      where: { id: item.id },
      data: {
        status: "accepted",
        acceptedAt: new Date(),
        acceptedPersonId: personId,
        interactionId: written.interactionId,
        summary: summary || item.summary,
      },
    })

    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Interaction",
      subjectId: written.interactionId,
      eventType: "staged_interaction.accepted",
      actor: input.actor,
      sourceConnector: item.source,
      // One accept per staged item, ever — a retry of this exact command
      // must not publish a second acceptance event even if it somehow raced
      // past the status check above.
      idempotencyKey: `staged-interaction-accept:${item.source}:${item.sourceId}`,
      payload: { stagedInteractionId: item.id, interactionId: written.interactionId, personId, created: written.created },
      provenance: { source: item.source, sourceId: item.sourceId, stagedInteractionId: item.id },
    })

    return written
  }, { timeout: 20_000, maxWait: 10_000 })

  await writeAuditLog({
    actor: input.actor,
    action: "inbox.accept",
    targetType: "stagedInteraction",
    targetId: item.id,
    metadata: { interactionId: result.interactionId, created: result.created },
  })

  // Best-effort so a ReviewItem exists for this item (whether staged before
  // or after A4) stays consistent whichever path resolved it — the human
  // Inbox, the auto-accept rule path, or a future resolveReviewItem call.
  await syncReviewItemStatus({
    source: "staged_interaction",
    sourceId: item.id,
    workspaceId,
    status: "accepted",
    resultType: "Interaction",
    resultId: result.interactionId,
    actor: input.actor,
  })

  return { status: "accepted", interactionId: result.interactionId, created: result.created }
}

registerReviewCommand("staged_interaction.accept", async (input, ctx) => {
  const result = await acceptStagedInteraction({
    id: input.stagedInteractionId as string,
    workspaceId: ctx.workspaceId,
    personId: input.personId as string | null | undefined,
    summary: input.summary as string | null | undefined,
    direction: input.direction as string | null | undefined,
    timestamp: input.timestamp as string | null | undefined,
    actor: ctx.actor,
  })
  return { resultType: "Interaction", resultId: result.interactionId }
})

function parseSourceMetadata(raw: string | null | undefined): { eventId?: string } {
  try {
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    return { eventId: typeof parsed.eventId === "string" ? parsed.eventId : undefined }
  } catch {
    return {}
  }
}

registerReviewDismiss("staged_interaction", async (sourceId, ctx) => {
  const { db } = await import("@life-os/db")
  await db.stagedInteraction.updateMany({
    where: { id: sourceId, workspaceId: ctx.workspaceId, status: { in: ["pending", "blocked"] } },
    data: { status: "dismissed" },
  })
})
