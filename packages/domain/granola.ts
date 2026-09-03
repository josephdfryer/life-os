import { createHash } from "node:crypto"
import { db } from "@life-os/db"
import { decrypt, encrypt } from "@life-os/db/crypto"
import { createReviewItem } from "./review"
import { calendarAttendeesFromSignals, declinedAttendeeEmails } from "./calendar-attendees"
import { GranolaClient, formatGranolaTranscript, type GranolaNote, type GranolaPerson } from "./granola-client"

const PROVIDER = "granola"
const CONNECTION_KIND = "meetings"
const INCREMENTAL_OVERLAP_MS = 5 * 60 * 1000

type ConnectionMetadata = {
  syncWatermark?: string
  importedCount?: number
  lastRun?: { imported: number; updated: number; failed: number; finishedAt: string }
}

export async function connectGranola(input: {
  workspaceId: string
  userId: string
  apiKey: string
}) {
  const apiKey = input.apiKey.trim()
  if (!apiKey.startsWith("grn_") || apiKey.length < 24) throw new Error("Enter a valid Granola API key")
  const client = new GranolaClient(apiKey)
  await client.validate()

  const existing = await db.connection.findFirst({
    where: { workspaceId: input.workspaceId, provider: PROVIDER, kind: CONNECTION_KIND },
    orderBy: { createdAt: "asc" },
  })
  const data = {
    userId: input.userId,
    status: "active",
    label: "Granola meetings",
    accessTokenEncrypted: encrypt(apiKey),
    lastError: null,
    scope: "accessible notes",
  }
  return existing
    ? db.connection.update({ where: { id: existing.id }, data })
    : db.connection.create({ data: { ...data, workspaceId: input.workspaceId, kind: CONNECTION_KIND, provider: PROVIDER } })
}

export async function disconnectGranola(workspaceId: string) {
  return db.connection.updateMany({
    where: { workspaceId, provider: PROVIDER, kind: CONNECTION_KIND },
    data: { status: "disabled", accessTokenEncrypted: null, lastError: null },
  })
}

export async function granolaStatus(workspaceId: string) {
  const connection = await db.connection.findFirst({
    where: { workspaceId, provider: PROVIDER, kind: CONNECTION_KIND },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, label: true, lastSyncedAt: true, lastError: true, metadata: true, scope: true },
  })
  if (!connection) return { connected: false as const }
  return {
    connected: connection.status === "active",
    status: connection.status,
    label: connection.label,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
    scope: connection.scope,
    metadata: parseMetadata(connection.metadata),
  }
}

export async function syncGranolaConnection(input: { workspaceId: string; fullBackfill?: boolean }) {
  const connection = await db.connection.findFirst({
    where: { workspaceId: input.workspaceId, provider: PROVIDER, kind: CONNECTION_KIND, status: "active" },
  })
  if (!connection?.accessTokenEncrypted) throw new Error("Granola is not connected")

  const client = new GranolaClient(decrypt(connection.accessTokenEncrypted))
  const metadata = parseMetadata(connection.metadata)
  const previousWatermark = input.fullBackfill ? null : parseDate(metadata.syncWatermark)
  const updatedAfter = previousWatermark
    ? new Date(previousWatermark.getTime() - INCREMENTAL_OVERLAP_MS)
    : undefined
  const runStartedAt = new Date()
  const summaries = await client.listAllNotes({ updatedAfter })
  let imported = 0
  let updated = 0
  let failed = 0
  const errors: string[] = []

  for (const summary of summaries) {
    try {
      const note = await client.getNote(summary.id)
      const result = await importGranolaNote({ workspaceId: input.workspaceId, connectionId: connection.id, note })
      result.created ? imported += 1 : updated += 1
    } catch (error) {
      failed += 1
      errors.push(`${summary.id}: ${errorMessage(error)}`)
    }
  }

  const nextMetadata: ConnectionMetadata = {
    ...metadata,
    syncWatermark: failed === 0 ? runStartedAt.toISOString() : metadata.syncWatermark,
    importedCount: (metadata.importedCount ?? 0) + imported,
    lastRun: { imported, updated, failed, finishedAt: new Date().toISOString() },
  }
  await db.connection.update({
    where: { id: connection.id },
    data: {
      metadata: JSON.stringify(nextMetadata),
      lastSyncedAt: failed === 0 ? new Date() : connection.lastSyncedAt,
      lastError: errors.length ? errors.slice(0, 10).join("\n") : null,
    },
  })
  return { imported, updated, failed, scanned: summaries.length, errors: errors.slice(0, 10) }
}

export async function syncAllGranolaConnections() {
  const connections = await db.connection.findMany({
    where: { provider: PROVIDER, kind: CONNECTION_KIND, status: "active", accessTokenEncrypted: { not: null } },
    select: { workspaceId: true },
  })
  const results = []
  const workspaceIds = [...new Set(connections.map(connection => connection.workspaceId))]
  for (const workspaceId of workspaceIds) {
    try {
      results.push({ workspaceId, ok: true, ...(await syncGranolaConnection({ workspaceId })) })
    } catch (error) {
      results.push({ workspaceId, ok: false, error: errorMessage(error) })
    }
  }
  return { connections: results.length, results }
}

export async function importGranolaNote(input: { workspaceId: string; connectionId: string; note: GranolaNote }) {
  const { workspaceId, connectionId, note } = input
  if (!note.id) throw new Error("Granola note is missing an id")
  const existingLink = await db.granolaNoteLink.findUnique({
    where: { workspaceId_externalNoteId: { workspaceId, externalNoteId: note.id } },
    select: { eventId: true },
  })
  const start = parseDate(note.calendar_event?.scheduled_start_time) ?? parseDate(note.created_at) ?? new Date()
  const end = parseDate(note.calendar_event?.scheduled_end_time)
  const title = note.title?.trim() || note.calendar_event?.event_title?.trim() || "Granola meeting"
  const transcript = formatGranolaTranscript(note.transcript)
  const summary = note.summary_markdown?.trim() || note.summary_text?.trim() || null
  const attendees = uniquePeople([
    note.owner,
    note.calendar_event?.organiser,
    ...(note.calendar_event?.invitees ?? []),
    ...(note.attendees ?? []),
  ])
  const contentHash = createHash("sha256").update(JSON.stringify({ title, start, end, summary, transcript, attendees })).digest("hex")

  const match = existingLink
    ? { eventId: existingLink.eventId, created: false }
    : await findMatchingEvent(workspaceId, note, title, start)
  const eventId = match?.eventId ?? null
  const existingEvent = eventId ? await db.event.findFirst({ where: { id: eventId, workspaceId } }) : null
  const metadata = mergeEventMetadata(existingEvent?.metadata, {
    noteId: note.id,
    sourceUrl: note.web_url ?? null,
    summary,
    owner: note.owner ?? null,
    organiser: note.calendar_event?.organiser ?? null,
    attendees,
    remoteUpdatedAt: note.updated_at ?? null,
    folderMembership: note.folder_membership ?? null,
  })

  const event = existingEvent
    ? await db.event.update({ where: { id: existingEvent.id }, data: { transcript, metadata } })
    : await createMeetingEvent({ workspaceId, title, start, end, transcript, metadata, note })

  await db.granolaNoteLink.upsert({
    where: { workspaceId_externalNoteId: { workspaceId, externalNoteId: note.id } },
    update: {
      connectionId, eventId: event.id, sourceUrl: note.web_url ?? null,
      calendarEventId: note.calendar_event?.calendar_event_id ?? null,
      remoteCreatedAt: parseDate(note.created_at), remoteUpdatedAt: parseDate(note.updated_at),
      contentHash, status: "synced", lastSyncedAt: new Date(), lastError: null,
    },
    create: {
      workspaceId, connectionId, eventId: event.id, externalNoteId: note.id,
      sourceUrl: note.web_url ?? null, calendarEventId: note.calendar_event?.calendar_event_id ?? null,
      remoteCreatedAt: parseDate(note.created_at), remoteUpdatedAt: parseDate(note.updated_at),
      contentHash, status: "synced", lastSyncedAt: new Date(),
    },
  })

  const resolutions = await linkAttendees({ workspaceId, eventId: event.id, note, title, summary, start, end, attendees, sourcePlanId: event.sourcePlanId })
  const group = await linkUnambiguousGroup(workspaceId, event.id, resolutions.personIds, start)
  await writeResolutionMetadata(event.id, metadata, resolutions, group)
  return { eventId: event.id, created: match?.created === true || !existingEvent, matchedPeople: resolutions.personIds.length, unresolved: resolutions.unresolved.length }
}

async function findMatchingEvent(workspaceId: string, note: GranolaNote, title: string, start: Date) {
  const calendarEventId = note.calendar_event?.calendar_event_id?.trim()
  if (calendarEventId) {
    const link = await db.calendarEventLink.findFirst({
      where: { workspaceId, OR: [{ externalEventId: calendarEventId }, { iCalUID: calendarEventId }] },
      select: { id: true, eventId: true, planId: true },
    })
    if (link?.eventId) return { eventId: link.eventId, created: false }
    if (link?.planId) {
      const event = await createMeetingEvent({ workspaceId, title, start, end: parseDate(note.calendar_event?.scheduled_end_time), transcript: null, metadata: null, note, sourcePlanId: link.planId })
      await db.$transaction([
        db.calendarEventLink.update({ where: { id: link.id }, data: { eventId: event.id } }),
        db.plan.update({ where: { id: link.planId }, data: { status: "completed", completedAt: start, reconciliationStatus: "happened", reconciledAt: new Date() } }),
      ])
      return { eventId: event.id, created: true }
    }
  }

  const candidates = await db.event.findMany({
    where: { workspaceId, start, name: { equals: title } },
    select: { id: true }, take: 2,
  })
  return candidates.length === 1 ? { eventId: candidates[0].id, created: false } : null
}

async function createMeetingEvent(input: {
  workspaceId: string; title: string; start: Date; end: Date | null; transcript: string | null
  metadata: string | null; note: GranolaNote; sourcePlanId?: string
}) {
  return db.event.create({ data: {
    workspaceId: input.workspaceId, name: input.title, type: "meeting",
    start: input.start, end: input.end, timestamp: input.start,
    transcript: input.transcript, metadata: input.metadata, sourcePlanId: input.sourcePlanId,
  } })
}

async function loadPersonEmailIndex(workspaceId: string) {
  const byEmail = new Map<string, string[]>()
  let cursor: string | undefined
  do {
    const rows = await db.person.findMany({
      where: { workspaceId }, select: { id: true, emails: true }, orderBy: { id: "asc" }, take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    for (const person of rows) {
      for (const email of parseEmails(person.emails)) {
        byEmail.set(email, [...(byEmail.get(email) ?? []), person.id])
      }
    }
    cursor = rows.length === 500 ? rows[rows.length - 1].id : undefined
  } while (cursor)
  return byEmail
}

async function linkAttendees(input: {
  workspaceId: string; eventId: string; note: GranolaNote; title: string; summary: string | null
  start: Date; end: Date | null; attendees: GranolaPerson[]; sourcePlanId?: string | null
}) {
  const index = await loadPersonEmailIndex(input.workspaceId)
  const declinedEmails = await calendarDeclinedEmails(input.workspaceId, input.note, input.sourcePlanId)
  const personIds: string[] = []
  const unresolved: Array<{ name: string | null; email: string }> = []
  const duration = input.end ? Math.max(0, Math.round((input.end.getTime() - input.start.getTime()) / 60000)) : null

  for (const attendee of input.attendees) {
    const email = normalizeEmail(attendee.email)
    if (!email) continue
    if (declinedEmails.has(email)) {
      await removeDeclinedGranolaAttendee(input.workspaceId, input.note.id, email)
      continue
    }
    const matches = index.get(email) ?? []
    if (matches.length === 1) {
      const personId = matches[0]
      personIds.push(personId)
      const interaction = await db.interaction.upsert({
        where: { workspaceId_source_sourceId: { workspaceId: input.workspaceId, source: PROVIDER, sourceId: `${input.note.id}:${email}` } },
        update: { personId, eventId: input.eventId, timestamp: input.start, duration, type: "meeting", summary: input.summary },
        create: { workspaceId: input.workspaceId, source: PROVIDER, sourceId: `${input.note.id}:${email}`, personId, eventId: input.eventId, timestamp: input.start, duration, type: "meeting", summary: input.summary },
      })
      await Promise.all([
        upsertParticipant(interaction.id, input.workspaceId, "Person", personId, "participant", { email }),
        upsertParticipant(interaction.id, input.workspaceId, "Event", input.eventId, "context", { noteId: input.note.id }),
      ])
    } else {
      unresolved.push({ name: attendee.name?.trim() || null, email })
      await stageUnknownAttendee({ ...input, attendee, email, matches })
    }
  }
  return { personIds: [...new Set(personIds)], unresolved }
}

async function calendarDeclinedEmails(workspaceId: string, note: GranolaNote, sourcePlanId?: string | null) {
  const signals: string[] = []
  if (sourcePlanId) {
    const plan = await db.plan.findFirst({
      where: { id: sourcePlanId, workspaceId },
      select: { successSignals: true },
    })
    if (plan?.successSignals) signals.push(plan.successSignals)
  }
  const calendarEventId = note.calendar_event?.calendar_event_id?.trim()
  if (calendarEventId) {
    const link = await db.calendarEventLink.findFirst({
      where: { workspaceId, OR: [{ externalEventId: calendarEventId }, { iCalUID: calendarEventId }] },
      select: { plan: { select: { successSignals: true } } },
    })
    if (link?.plan?.successSignals) signals.push(link.plan.successSignals)
  }
  const declined = new Set<string>()
  for (const raw of signals) {
    for (const email of declinedAttendeeEmails(calendarAttendeesFromSignals(raw))) declined.add(email)
  }
  return declined
}

async function removeDeclinedGranolaAttendee(workspaceId: string, noteId: string, email: string) {
  const sourceId = `${noteId}:${email}`
  await db.interaction.deleteMany({
    where: {
      workspaceId,
      source: PROVIDER,
      sourceId,
      emotionalWeight: null,
      outcome: null,
      notes: null,
    },
  })
  await db.stagedInteraction.deleteMany({
    where: { workspaceId, source: PROVIDER, sourceId },
  })
}

async function stageUnknownAttendee(input: {
  workspaceId: string; eventId: string; note: GranolaNote; title: string; start: Date
  attendee: GranolaPerson; email: string; matches: string[]
}) {
  const staged = await db.stagedInteraction.upsert({
    where: { workspaceId_source_sourceId: { workspaceId: input.workspaceId, source: PROVIDER, sourceId: `${input.note.id}:${input.email}` } },
    update: {
      contactName: input.attendee.name?.trim() || null, contactEmail: input.email, timestamp: input.start,
      summary: `Attended ${input.title}`, metadata: JSON.stringify({ eventId: input.eventId, granolaNoteId: input.note.id, sourceUrl: input.note.web_url ?? null }),
      confidence: input.matches.length ? 0.5 : 0, matchReason: input.matches.length ? "Email matched multiple people" : "No exact email match",
    },
    create: {
      workspaceId: input.workspaceId, source: PROVIDER, sourceId: `${input.note.id}:${input.email}`,
      itemType: "interaction", type: "meeting", contactName: input.attendee.name?.trim() || null,
      contactEmail: input.email, timestamp: input.start, summary: `Attended ${input.title}`,
      metadata: JSON.stringify({ eventId: input.eventId, granolaNoteId: input.note.id, sourceUrl: input.note.web_url ?? null }),
      confidence: input.matches.length ? 0.5 : 0, matchReason: input.matches.length ? "Email matched multiple people" : "No exact email match",
    },
  })
  await createReviewItem({
    workspaceId: input.workspaceId, source: "staged_interaction", sourceId: staged.id,
    itemType: "interaction", command: "staged_interaction.accept",
    commandInput: { stagedInteractionId: staged.id }, targetType: "Person", targetId: input.matches.length === 1 ? input.matches[0] : null,
    confidence: input.matches.length ? 0.5 : 0, riskTier: "review",
    evidence: { provider: PROVIDER, noteId: input.note.id, eventId: input.eventId, email: input.email, candidateCount: input.matches.length },
  })
}

async function upsertParticipant(interactionId: string, workspaceId: string, entityType: string, entityId: string, role: string, evidence: Record<string, unknown>) {
  return db.interactionParticipant.upsert({
    where: { interactionId_entityType_entityId_role: { interactionId, entityType, entityId, role } },
    update: { source: PROVIDER, confidence: 1, band: "auto", evidence: JSON.stringify(evidence) },
    create: { interactionId, workspaceId, entityType, entityId, role, source: PROVIDER, confidence: 1, band: "auto", evidence: JSON.stringify(evidence) },
  })
}

async function linkUnambiguousGroup(workspaceId: string, eventId: string, personIds: string[], at: Date) {
  if (personIds.length < 2) return null
  const memberships = await db.personGroup.findMany({
    where: {
      personId: { in: personIds }, group: { workspaceId },
      AND: [{ OR: [{ startDate: null }, { startDate: { lte: at } }] }, { OR: [{ endDate: null }, { endDate: { gte: at } }] }],
    },
    select: { groupId: true, personId: true, group: { select: { name: true } } },
  })
  const counts = new Map<string, { name: string; people: Set<string> }>()
  for (const row of memberships) {
    const entry = counts.get(row.groupId) ?? { name: row.group.name, people: new Set<string>() }
    entry.people.add(row.personId)
    counts.set(row.groupId, entry)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1].people.size - a[1].people.size)
  const winner = ranked[0]
  if (!winner || winner[1].people.size < 2 || ranked[1]?.[1].people.size === winner[1].people.size) return null
  await db.event.update({ where: { id: eventId }, data: { groupTags: { connect: { id: winner[0] } } } })
  return { id: winner[0], name: winner[1].name, matchedPeople: winner[1].people.size, totalPeople: personIds.length }
}

async function writeResolutionMetadata(eventId: string, existing: string, resolutions: { personIds: string[]; unresolved: unknown[] }, group: unknown) {
  const parsed = JSON.parse(existing) as Record<string, unknown>
  const granola = parsed.granola as Record<string, unknown>
  granola.identityResolution = { matchedPersonIds: resolutions.personIds, unresolvedCount: resolutions.unresolved.length }
  granola.groupInference = group
  await db.event.update({ where: { id: eventId }, data: { metadata: JSON.stringify(parsed) } })
}

function mergeEventMetadata(raw: string | null | undefined, granola: Record<string, unknown>) {
  let existing: Record<string, unknown> = {}
  try { existing = raw ? JSON.parse(raw) as Record<string, unknown> : {} } catch { existing = {} }
  return JSON.stringify({ ...existing, granola: { ...((existing.granola as Record<string, unknown> | undefined) ?? {}), ...granola } })
}

function uniquePeople(values: Array<GranolaPerson | null | undefined>) {
  const seen = new Set<string>()
  return values.filter((person): person is GranolaPerson => {
    if (!person) return false
    const key = normalizeEmail(person.email) ?? `name:${person.name?.trim().toLowerCase() ?? ""}`
    if (!key || key === "name:" || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase()
  return email && email.includes("@") ? email : null
}

function parseEmails(raw: string) {
  try {
    const values = JSON.parse(raw)
    return Array.isArray(values) ? values.flatMap((value) => typeof value === "string" && normalizeEmail(value) ? [normalizeEmail(value)!] : []) : []
  } catch { return [] }
}

function parseMetadata(raw: string | null | undefined): ConnectionMetadata {
  try { return raw ? JSON.parse(raw) as ConnectionMetadata : {} } catch { return {} }
}

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Granola sync error"
}
