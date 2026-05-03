import { db } from "@/lib/db"
import { badRequest, notFound, optionalString, optionalStringArray, requiredString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import { formatInteraction, jsonList } from "./dto"
import { appendUniqueLine, findInteractionByExactSource, normalizeSourceMarker } from "./idempotency"

const DAY_TIME_ZONE = "America/Los_Angeles"

export type InteractionInput = {
  personId?: unknown
  type?: unknown
  timestamp?: unknown
  duration?: unknown
  summary?: unknown
  notes?: unknown
  emotionalWeight?: unknown
  outcome?: unknown
  actionItems?: unknown
  billable?: unknown
  amount?: unknown
  direction?: unknown
  eventId?: unknown
  sourceFileId?: unknown
}

export async function createInteraction(input: InteractionInput, actor?: DomainActor) {
  const type = requiredString(input.type, "type")
  const timestamp = parseTimestamp(input.timestamp)
  const summary = optionalString(input.summary)
  const personId = optionalString(input.personId)
  const eventId = optionalString(input.eventId)

  let resolvedEventId = eventId
  if (!resolvedEventId) {
    const event = await db.event.create({
      data: {
        name: summary ? summary.slice(0, 80) : `${type} interaction`,
        type,
        timestamp,
      },
    })
    resolvedEventId = event.id
  }

  const interaction = await db.interaction.create({
    data: {
      personId,
      eventId: resolvedEventId,
      type,
      timestamp,
      duration: input.duration ? Number(input.duration) : null,
      summary,
      notes: optionalString(input.notes),
      emotionalWeight: optionalString(input.emotionalWeight),
      outcome: optionalString(input.outcome),
      actionItems: Array.isArray(input.actionItems) ? jsonList(optionalStringArray(input.actionItems)) : null,
      billable: Boolean(input.billable),
      amount: input.amount ? Number(input.amount) : null,
      direction: optionalString(input.direction),
      sourceFileId: optionalString(input.sourceFileId),
    },
    include: { event: true, sourceFile: true },
  })

  await auditAction({ actor, action: "interaction.create", targetType: "interaction", targetId: interaction.id })
  return formatInteraction(interaction)
}

export async function deleteInteraction(id: string, actor?: DomainActor) {
  const existing = await db.interaction.findUnique({ where: { id }, select: { id: true } })
  if (!existing) throw notFound("Interaction not found", { id })
  await db.interaction.delete({ where: { id } })
  await auditAction({ actor, action: "interaction.delete", targetType: "interaction", targetId: id })
}

export async function appendDailySourceInteraction(input: {
  personId: string
  source: string
  sourceId: string
  type: string
  timestamp: Date
  summary: string
  body?: string | null
  direction?: string | null
  actor?: DomainActor
}) {
  const existingSource = await findInteractionByExactSource(input.source, input.sourceId, input.personId)
  if (existingSource) return { interactionId: existingSource.id, created: false, updated: false }

  const dayMarker = `${input.source}-day:${dayKey(input.timestamp)}`
  const dailyInteraction = await db.interaction.findFirst({
    where: {
      personId: input.personId,
      type: input.type,
      notes: { contains: dayMarker },
    },
    select: { id: true, summary: true, notes: true, direction: true },
    orderBy: { timestamp: "asc" },
  })

  const line = messageLine(input.timestamp, input.direction, input.summary || input.body || "(no text)")
  const sourceMarker = normalizeSourceMarker(input.source, input.sourceId)

  if (dailyInteraction) {
    const interaction = await db.interaction.update({
      where: { id: dailyInteraction.id },
      data: {
        summary: appendUniqueLine(dailyInteraction.summary, line),
        notes: appendUniqueLine(dailyInteraction.notes, sourceMarker),
        direction: dailyInteraction.direction === input.direction ? dailyInteraction.direction : "mixed",
      },
      select: { id: true },
    })
    await auditAction({ actor: input.actor, action: "interaction.create", targetType: "interaction", targetId: interaction.id, metadata: { mode: "append", source: input.source, sourceId: input.sourceId } })
    return { interactionId: interaction.id, created: false, updated: true }
  }

  const event = await db.event.create({
    data: {
      name: `${input.source} ${dayKey(input.timestamp)}`.slice(0, 80),
      type: input.type,
      timestamp: input.timestamp,
      metadata: JSON.stringify({ source: input.source, day: dayKey(input.timestamp) }),
    },
  })

  const interaction = await db.interaction.create({
    data: {
      personId: input.personId,
      eventId: event.id,
      type: input.type,
      timestamp: input.timestamp,
      summary: line,
      notes: `${dayMarker}\n${sourceMarker}`,
      direction: input.direction ?? null,
    },
    select: { id: true },
  })
  await auditAction({ actor: input.actor, action: "interaction.create", targetType: "interaction", targetId: interaction.id, metadata: { mode: "create", source: input.source, sourceId: input.sourceId } })
  return { interactionId: interaction.id, created: true, updated: false }
}

function parseTimestamp(value: unknown) {
  const date = value ? new Date(String(value)) : new Date()
  if (Number.isNaN(date.getTime())) throw badRequest("timestamp is invalid", { field: "timestamp" })
  return date
}

function dayKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function messageLine(timestamp: Date, direction: string | null | undefined, summary: string) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: DAY_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp)
  return `[${time}${direction ? ` ${direction}` : ""}] ${summary}`
}
