import { createHmac, randomBytes } from "crypto"
import { decryptNullable, encryptNullable } from "@life-os/db/crypto"
import { db } from "@/lib/db"
import { badRequest, forbidden, notFound } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import type { AccessActor } from "./access"
import { googleFetch, requestGoogleToken, type GoogleTokenResponse } from "@/server/integrations/google/client"
import { listGoogleCalendarEventPages } from "@/server/integrations/google/calendar-client"
import {
  googleEventMetadata,
  parseGoogleDate,
  type CalendarEventMetadata,
  type GoogleCalendarEvent,
} from "@/server/integrations/google/calendar-event-parser"
import { calendarEventMetadataContract, decodeStoredJson, storedStringList } from "@life-os/contracts"
import { startWorkflowRun, syncHealth } from "@/server/observability/workflow"

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
const SOURCE = "google-calendar"
const DEFAULT_BACKFILL_DAYS = 180
const MAX_BACKFILL_DAYS = 3650
const DB_BATCH_SIZE = 25

type OAuthState = {
  workspaceId: string
  userId: string
  nonce: string
  returnTo: string
}

type TokenResponse = GoogleTokenResponse

export function googleCalendarConfigured() {
  return Boolean(calendarClientId() && calendarClientSecret())
}

export async function googleCalendarStatus(actor: AccessActor) {
  const connection = await db.calendarConnection.findFirst({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      accountEmail: true,
      calendarId: true,
      calendarSummary: true,
      scope: true,
      lastSyncedAt: true,
      lastError: true,
      updatedAt: true,
      _count: { select: { eventLinks: true } },
    },
  })

  return {
    configured: googleCalendarConfigured(),
    redirectUri: googleCalendarRedirectUri(null),
    connection: connection ? {
      ...connection,
      eventCount: connection._count.eventLinks,
      syncHealth: syncHealth(connection.lastSyncedAt, connection.lastError),
      _count: undefined,
    } : null,
  }
}

export async function googleCalendarTrace(actor: AccessActor, options: { limit?: number } = {}) {
  const limit = normalizeTraceLimit(options.limit)
  const connection = await db.calendarConnection.findFirst({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, calendarId: true, accountEmail: true, calendarSummary: true },
  })

  const runs = await db.auditLog.findMany({
    where: { workspaceId: actor.workspaceId, action: "calendar.sync" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, actorLabel: true, metadata: true },
  })

  const links = connection ? await db.calendarEventLink.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google", connectionId: connection.id },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      event: {
        select: {
          id: true,
          name: true,
          timestamp: true,
          createdAt: true,
          metadata: true,
          interactions: {
            where: { type: "calendar" },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              createdAt: true,
              timestamp: true,
              summary: true,
              notes: true,
              person: { select: { id: true, first: true, last: true, emails: true } },
            },
          },
        },
      },
    },
  }) : []

  return {
    connection,
    runs: runs.map(run => ({
      id: run.id,
      createdAt: run.createdAt,
      actorLabel: run.actorLabel,
      metadata: parseJsonObject(run.metadata),
    })),
    events: links.map(link => {
      const metadata = parseCalendarMetadata(link.event?.metadata)
      const marker = sourceMarker(link.calendarId, link.externalEventId)
      const linkedInteractions = (link.event?.interactions ?? [])
        .filter(interaction => interaction.person && (interaction.notes ?? "").includes(marker))
        .map(interaction => ({
          id: interaction.id,
          createdAt: interaction.createdAt,
          timestamp: interaction.timestamp,
          summary: interaction.summary,
          person: interaction.person ? {
            id: interaction.person.id,
            name: personName(interaction.person),
            emails: parseJsonList(interaction.person.emails),
          } : null,
        }))

      return {
        id: link.id,
        status: link.status,
        calendarId: link.calendarId,
        externalEventId: link.externalEventId,
        iCalUID: link.iCalUID,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
        lastSeenAt: link.lastSeenAt,
        event: link.event ? {
          id: link.event.id,
          name: link.event.name,
          timestamp: link.event.timestamp,
          createdAt: link.event.createdAt,
          htmlLink: metadata.htmlLink ?? null,
          location: metadata.location ?? null,
          attendeeCount: metadata.attendees?.length ?? 0,
          attendees: (metadata.attendees ?? []).slice(0, 12),
        } : null,
        linkedPeople: linkedInteractions,
      }
    }),
  }
}

export function googleCalendarAuthUrl(actor: AccessActor, origin: string, returnTo = "/admin") {
  const clientId = calendarClientId()
  if (!clientId || !calendarClientSecret()) throw badRequest("Google Calendar OAuth is not configured")
  const redirectUri = googleCalendarRedirectUri(origin)
  const state = signState({ workspaceId: actor.workspaceId, userId: actor.userId, nonce: randomBytes(12).toString("hex"), returnTo })
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export async function handleGoogleCalendarCallback(input: { code: string; state: string; origin: string }) {
  const state = verifyState(input.state)
  const token = await exchangeCode(input.code, googleCalendarRedirectUri(input.origin))
  if (!token.refresh_token) {
    throw badRequest("Google did not return a refresh token. Reconnect Calendar and approve offline access.")
  }

  const accountEmail = await fetchGoogleAccountEmail(token.access_token)
  const calendar = await fetchPrimaryCalendar(token.access_token)
  const calendarId = "primary"
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null

  const connection = await db.calendarConnection.upsert({
    where: {
      workspaceId_provider_calendarId: {
        workspaceId: state.workspaceId,
        provider: "google",
        calendarId,
      },
    },
    update: {
      userId: state.userId,
      status: "active",
      accountEmail,
      calendarSummary: calendar.summary ?? accountEmail,
      accessTokenEncrypted: encryptNullable(token.access_token),
      refreshTokenEncrypted: encryptNullable(token.refresh_token),
      expiresAt,
      scope: token.scope ?? CALENDAR_SCOPE,
      lastError: null,
    },
    create: {
      workspaceId: state.workspaceId,
      userId: state.userId,
      provider: "google",
      status: "active",
      accountEmail,
      calendarId,
      calendarSummary: calendar.summary ?? accountEmail,
      accessTokenEncrypted: encryptNullable(token.access_token),
      refreshTokenEncrypted: encryptNullable(token.refresh_token),
      expiresAt,
      scope: token.scope ?? CALENDAR_SCOPE,
    },
  })

  await auditAction({
    actor: { type: "user", id: state.userId, workspaceId: state.workspaceId },
    action: "calendar.connect",
    targetType: "calendarConnection",
    targetId: connection.id,
    metadata: { provider: "google", accountEmail, calendarId },
  })

  return { returnTo: state.returnTo, connectionId: connection.id }
}

type SyncOptions = {
  backfillDays?: number | null
}

type SyncStats = {
  createdEvents: number
  updatedEvents: number
  createdInteractions: number
  cancelled: number
  fetched: number
  batches: number
  backfillDays: number
  incremental: boolean
}

export async function syncGoogleCalendar(actor: AccessActor, options: SyncOptions = {}) {
  const connection = await db.calendarConnection.findFirst({
    where: { workspaceId: actor.workspaceId, provider: "google", status: "active" },
    orderBy: { updatedAt: "desc" },
  })
  if (!connection) throw notFound("Google Calendar is not connected")
  if (!connection.refreshTokenEncrypted && !connection.accessTokenEncrypted) throw badRequest("Google Calendar connection has no usable token")

  const accessToken = await usableAccessToken({
    id: connection.id,
    accessToken: decryptNullable(connection.accessTokenEncrypted),
    refreshToken: decryptNullable(connection.refreshTokenEncrypted),
    expiresAt: connection.expiresAt,
  })
  const syncToken = decryptNullable(connection.syncTokenEncrypted)
  const backfillDays = normalizeBackfillDays(options.backfillDays)
  const stats: SyncStats = {
    createdEvents: 0,
    updatedEvents: 0,
    createdInteractions: 0,
    cancelled: 0,
    fetched: 0,
    batches: 0,
    backfillDays,
    incremental: Boolean(syncToken),
  }
  const telemetry = startWorkflowRun({ workflow: "calendar.sync", workspaceId: actor.workspaceId, targetId: connection.id, context: { calendarId: connection.calendarId, incremental: stats.incremental } })

  try {
    const peopleByEmail = await peopleEmailIndex(actor.workspaceId)
    const listed = await syncEventPages(accessToken, {
      calendarId: connection.calendarId,
      syncToken,
      backfillDays,
      onBatch: async items => {
        stats.batches += 1
        const result = await processCalendarBatch({
          actor: actor.actor,
          workspaceId: actor.workspaceId,
          connectionId: connection.id,
          calendarId: connection.calendarId,
          items,
          peopleByEmail,
        })
        stats.createdEvents += result.createdEvents
        stats.updatedEvents += result.updatedEvents
        stats.createdInteractions += result.createdInteractions
        stats.cancelled += result.cancelled
        stats.fetched += result.fetched
      }
    })
    stats.incremental = listed.usedSyncToken

    await db.calendarConnection.update({
      where: { id: connection.id },
      data: {
        syncTokenEncrypted: encryptNullable(listed.nextSyncToken ?? syncToken),
        lastSyncedAt: new Date(),
        lastError: null,
      },
    })

    await auditAction({
      actor: actor.actor,
      action: "calendar.sync",
      targetType: "calendarConnection",
      targetId: connection.id,
      metadata: { provider: "google", ...stats },
    })

    telemetry.finish("succeeded", stats)
    return { ...stats, runId: telemetry.runId }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Calendar sync failed"
    await db.calendarConnection.update({ where: { id: connection.id }, data: { lastError: message } })
    telemetry.finish("failed", stats, error)
    throw error
  }
}

async function processCalendarBatch(input: {
  actor: DomainActor
  workspaceId: string
  connectionId: string
  calendarId: string
  items: GoogleCalendarEvent[]
  peopleByEmail: Map<string, { id: string; first: string; last: string }>
}) {
  let createdEvents = 0
  let updatedEvents = 0
  let createdInteractions = 0
  let cancelled = 0
  let fetched = 0

  for (const item of input.items) {
    if (!item.id) continue
    fetched += 1
    if (item.status === "cancelled") {
      cancelled += await markCancelled(input.connectionId, input.workspaceId, input.calendarId, item.id)
      continue
    }
    const result = await upsertCalendarEvent({
      actor: input.actor,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      calendarId: input.calendarId,
      item,
      peopleByEmail: input.peopleByEmail,
    })
    if (result.createdEvent) createdEvents += 1
    else updatedEvents += 1
    createdInteractions += result.createdInteractions
  }

  return { createdEvents, updatedEvents, createdInteractions, cancelled, fetched }
}

async function upsertCalendarEvent(input: {
  actor: DomainActor
  workspaceId: string
  connectionId: string
  calendarId: string
  item: GoogleCalendarEvent
  peopleByEmail: Map<string, { id: string; first: string; last: string }>
}) {
  const start = parseGoogleDate(input.item.start)
  if (!start) return { createdEvent: false, createdInteractions: 0 }
  const end = parseGoogleDate(input.item.end)
  const metadata = googleEventMetadata(input.item, input.calendarId)
  const link = await db.calendarEventLink.findUnique({
    where: {
      workspaceId_provider_calendarId_externalEventId: {
        workspaceId: input.workspaceId,
        provider: "google",
        calendarId: input.calendarId,
        externalEventId: input.item.id,
      },
    },
    include: { event: true },
  })

  let eventId = link?.eventId ?? null
  let createdEvent = false
  if (eventId) {
    await db.event.update({
      where: { id: eventId },
      data: {
        name: input.item.summary?.trim() || "Untitled Google Calendar event",
        type: "calendar",
        timestamp: start,
        notes: input.item.description ?? null,
        metadata: JSON.stringify(metadata),
      },
    })
  } else {
    const event = await db.event.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.item.summary?.trim() || "Untitled Google Calendar event",
        type: "calendar",
        start,
        end: end ?? null,
        timestamp: start,
        notes: input.item.description ?? null,
        metadata: JSON.stringify(metadata),
      },
      select: { id: true },
    })
    eventId = event.id
    createdEvent = true
    await auditAction({ actor: input.actor, action: "event.create", targetType: "event", targetId: event.id, metadata: { source: SOURCE, externalEventId: input.item.id } })
  }

  await db.calendarEventLink.upsert({
    where: {
      workspaceId_provider_calendarId_externalEventId: {
        workspaceId: input.workspaceId,
        provider: "google",
        calendarId: input.calendarId,
        externalEventId: input.item.id,
      },
    },
    update: { eventId, iCalUID: input.item.iCalUID ?? null, status: input.item.status ?? "confirmed", lastSeenAt: new Date() },
    create: {
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      provider: "google",
      calendarId: input.calendarId,
      externalEventId: input.item.id,
      iCalUID: input.item.iCalUID ?? null,
      eventId,
      status: input.item.status ?? "confirmed",
      lastSeenAt: new Date(),
    },
  })

  const matchedPeople = matchedAttendees(input.item, input.peopleByEmail)
  let createdInteractions = 0
  for (const person of matchedPeople) {
    const existing = await db.interaction.findFirst({
      where: {
        workspaceId: input.workspaceId,
        eventId,
        personId: person.id,
        type: "calendar",
        notes: { contains: sourceMarker(input.calendarId, input.item.id) },
      },
      select: { id: true },
    })
    if (existing) continue
    const interaction = await db.interaction.create({
      data: {
        workspaceId: input.workspaceId,
        eventId,
        personId: person.id,
        type: "calendar",
        timestamp: start,
        duration: end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : null,
        summary: input.item.summary ?? "Google Calendar event",
        notes: [sourceMarker(input.calendarId, input.item.id), input.item.htmlLink].filter(Boolean).join("\n"),
        direction: "meeting",
      },
      select: { id: true },
    })
    createdInteractions += 1
    await auditAction({
      actor: input.actor,
      action: "interaction.create",
      targetType: "interaction",
      targetId: interaction.id,
      metadata: {
        mode: "calendar-sync",
        source: SOURCE,
        calendarId: input.calendarId,
        externalEventId: input.item.id,
        eventId,
        personId: person.id,
        personName: personName(person),
      },
    })
  }

  return { createdEvent, createdInteractions }
}

async function peopleEmailIndex(workspaceId: string) {
  const rows = await db.person.findMany({
    where: { workspaceId },
    select: { id: true, first: true, last: true, emails: true },
  })
  const byEmail = new Map<string, { id: string; first: string; last: string }>()
  for (const row of rows) {
    for (const email of parseJsonList(row.emails)) byEmail.set(email.toLowerCase(), row)
  }
  return byEmail
}

function matchedAttendees(item: GoogleCalendarEvent, peopleByEmail: Map<string, { id: string; first: string; last: string }>) {
  const seen = new Set<string>()
  const people: { id: string; first: string; last: string }[] = []
  const attendeeEmails = [
    ...(item.attendees ?? []).map(attendee => attendee.email),
    item.organizer?.email,
    item.creator?.email,
  ].filter((email): email is string => Boolean(email))
  for (const email of attendeeEmails) {
    const person = peopleByEmail.get(email.toLowerCase())
    if (!person || seen.has(person.id)) continue
    seen.add(person.id)
    people.push(person)
  }
  return people
}

async function markCancelled(connectionId: string, workspaceId: string, calendarId: string, externalEventId: string) {
  const link = await db.calendarEventLink.findUnique({
    where: { workspaceId_provider_calendarId_externalEventId: { workspaceId, provider: "google", calendarId, externalEventId } },
    select: { id: true },
  })
  if (!link) return 0
  await db.calendarEventLink.update({ where: { id: link.id }, data: { connectionId, status: "cancelled", lastSeenAt: new Date() } })
  return 1
}

async function usableAccessToken(connection: { id: string; accessToken: string | null; refreshToken: string | null; expiresAt: Date | null }) {
  if (connection.accessToken && connection.expiresAt && connection.expiresAt.getTime() > Date.now() + 60_000) {
    return connection.accessToken
  }
  if (!connection.refreshToken) {
    if (connection.accessToken) return connection.accessToken
    throw badRequest("Google Calendar connection has no refresh token")
  }
  const token = await refreshAccessToken(connection.refreshToken)
  await db.calendarConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encryptNullable(token.access_token),
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      refreshTokenEncrypted: encryptNullable(token.refresh_token ?? connection.refreshToken),
      scope: token.scope ?? undefined,
    },
  })
  return token.access_token
}

async function syncEventPages(
  accessToken: string,
  input: {
    calendarId: string
    syncToken: string | null
    backfillDays: number
    onBatch: (items: GoogleCalendarEvent[]) => Promise<void>
  }
) {
  return await listGoogleCalendarEventPages({
    accessToken,
    calendarId: input.calendarId,
    syncToken: input.syncToken,
    backfillDays: input.backfillDays,
    onPage: async items => {
      for (const batch of chunk(items, DB_BATCH_SIZE)) await input.onBatch(batch)
    },
  })
}

async function exchangeCode(code: string, redirectUri: string) {
  const clientId = calendarClientId()
  const clientSecret = calendarClientSecret()
  if (!clientId || !clientSecret) throw badRequest("Google Calendar OAuth is not configured")
  return await requestGoogleToken({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
  })
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = calendarClientId()
  const clientSecret = calendarClientSecret()
  if (!clientId || !clientSecret) throw badRequest("Google Calendar OAuth is not configured")
  return await requestGoogleToken({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
  })
}

async function fetchPrimaryCalendar(accessToken: string) {
  const res = await googleFetch(`${GOOGLE_CALENDAR_BASE}/calendars/primary`, accessToken)
  if (!res.ok) return {}
  return await res.json() as { summary?: string }
}

async function fetchGoogleAccountEmail(accessToken: string) {
  const res = await googleFetch(GOOGLE_USERINFO_URL, accessToken)
  if (!res.ok) return null
  const data = await res.json() as { email?: string }
  return data.email ?? null
}

function googleCalendarRedirectUri(origin: string | null) {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI
  if (explicit) return explicit
  const base = process.env.AUTH_URL
    || process.env.NEXTAUTH_URL
    || vercelProductionUrl()
    || origin
  if (!base) throw badRequest("Google Calendar redirect URI could not be resolved")
  return `${base.replace(/\/$/, "")}/api/calendar/google/callback`
}

function signState(state: OAuthState) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url")
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

function verifyState(value: string) {
  const [payload, signature] = value.split(".")
  if (!payload || !signature) throw badRequest("Invalid Google Calendar state")
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("base64url")
  if (signature !== expected) throw forbidden("Invalid Google Calendar state signature")
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState
}

function stateSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "dev-calendar-state-secret"
}

function calendarClientId() {
  return process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || null
}

function calendarClientSecret() {
  return process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || null
}

function vercelProductionUrl() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return host ? `https://${host}` : null
}

function sourceMarker(calendarId: string, eventId: string) {
  return `${SOURCE}:${calendarId}:${eventId}`
}

function parseJsonList(value: string | null) {
  return decodeStoredJson(value, storedStringList, "Person.emails", [])
}

function parseJsonObject(value: string | null) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseCalendarMetadata(value: string | null | undefined): CalendarEventMetadata {
  return decodeStoredJson(value, calendarEventMetadataContract, "Event.calendarMetadata", {}) as CalendarEventMetadata
}

function normalizeBackfillDays(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BACKFILL_DAYS
  const days = Math.round(value)
  if (days < 1) return DEFAULT_BACKFILL_DAYS
  return Math.min(days, MAX_BACKFILL_DAYS)
}

function normalizeTraceLimit(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50
  const limit = Math.round(value)
  if (limit < 1) return 50
  return Math.min(limit, 150)
}

function personName(person: { first: string; last: string }) {
  return [person.first, person.last].filter(Boolean).join(" ").trim() || "Unnamed person"
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}
