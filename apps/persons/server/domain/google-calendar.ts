import { createHmac, randomBytes } from "crypto"
import { db } from "@/lib/db"
import { badRequest, forbidden, notFound } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import type { AccessActor } from "./access"

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
const SOURCE = "google-calendar"
const DEFAULT_BACKFILL_DAYS = 180
const MAX_BACKFILL_DAYS = 3650
const GOOGLE_PAGE_SIZE = 100
const DB_BATCH_SIZE = 25

type OAuthState = {
  workspaceId: string
  userId: string
  nonce: string
  returnTo: string
}

type TokenResponse = {
  access_token: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  token_type?: string
}

type GoogleCalendarEvent = {
  id: string
  iCalUID?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[]
  organizer?: { email?: string; displayName?: string; self?: boolean }
  creator?: { email?: string; displayName?: string; self?: boolean }
  updated?: string
}

type EventsListResponse = {
  items?: GoogleCalendarEvent[]
  nextPageToken?: string
  nextSyncToken?: string
  summary?: string
}

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
      syncToken: true,
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
      _count: undefined,
    } : null,
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
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
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
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
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
  if (!connection.refreshToken && !connection.accessToken) throw badRequest("Google Calendar connection has no usable token")

  const accessToken = await usableAccessToken(connection)
  const backfillDays = normalizeBackfillDays(options.backfillDays)

  try {
    const peopleByEmail = await peopleEmailIndex(actor.workspaceId)
    const stats: SyncStats = {
      createdEvents: 0,
      updatedEvents: 0,
      createdInteractions: 0,
      cancelled: 0,
      fetched: 0,
      batches: 0,
      backfillDays,
      incremental: Boolean(connection.syncToken),
    }
    const listed = await syncEventPages(accessToken, {
      calendarId: connection.calendarId,
      syncToken: connection.syncToken,
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
        syncToken: listed.nextSyncToken ?? connection.syncToken,
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

    return stats
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Calendar sync failed"
    await db.calendarConnection.update({ where: { id: connection.id }, data: { lastError: message } })
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
    await db.interaction.create({
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
    })
    createdInteractions += 1
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
      accessToken: token.access_token,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      refreshToken: token.refresh_token ?? connection.refreshToken,
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
  let pageToken: string | undefined
  let nextSyncToken: string | undefined
  let useSyncToken = Boolean(input.syncToken)
  let usedSyncToken = useSyncToken

  for (;;) {
    const params = new URLSearchParams({
      maxResults: String(GOOGLE_PAGE_SIZE),
      showDeleted: "true",
      singleEvents: "true",
    })
    if (pageToken) params.set("pageToken", pageToken)
    if (useSyncToken && input.syncToken) {
      params.set("syncToken", input.syncToken)
    } else {
      usedSyncToken = false
      const now = Date.now()
      params.set("timeMin", new Date(now - input.backfillDays * 24 * 60 * 60 * 1000).toISOString())
      params.set("timeMax", new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString())
      params.set("orderBy", "startTime")
    }

    const res = await googleFetch(`${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?${params}`, accessToken)
    if (res.status === 410 && useSyncToken) {
      useSyncToken = false
      usedSyncToken = false
      pageToken = undefined
      continue
    }
    if (!res.ok) throw new Error(`Google Calendar events request failed (${res.status})`)
    const data = await res.json() as EventsListResponse
    for (const batch of chunk(data.items ?? [], DB_BATCH_SIZE)) {
      await input.onBatch(batch)
    }
    pageToken = data.nextPageToken
    nextSyncToken = data.nextSyncToken ?? nextSyncToken
    if (!pageToken) break
  }

  return { nextSyncToken, usedSyncToken }
}

async function exchangeCode(code: string, redirectUri: string) {
  const clientId = calendarClientId()
  const clientSecret = calendarClientSecret()
  if (!clientId || !clientSecret) throw badRequest("Google Calendar OAuth is not configured")
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`)
  return await res.json() as TokenResponse
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = calendarClientId()
  const clientSecret = calendarClientSecret()
  if (!clientId || !clientSecret) throw badRequest("Google Calendar OAuth is not configured")
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`)
  return await res.json() as TokenResponse
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

function googleFetch(url: string, accessToken: string) {
  return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
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

function parseGoogleDate(value: GoogleCalendarEvent["start"] | GoogleCalendarEvent["end"]) {
  const raw = value?.dateTime ?? value?.date
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function googleEventMetadata(item: GoogleCalendarEvent, calendarId: string) {
  return {
    source: SOURCE,
    calendarId,
    googleEventId: item.id,
    googleEventKey: `${calendarId}:${item.id}`,
    iCalUID: item.iCalUID ?? null,
    status: item.status ?? null,
    htmlLink: item.htmlLink ?? null,
    location: item.location ?? null,
    start: item.start ?? null,
    end: item.end ?? null,
    updated: item.updated ?? null,
    attendees: (item.attendees ?? []).map(attendee => ({
      email: attendee.email ?? null,
      displayName: attendee.displayName ?? null,
      responseStatus: attendee.responseStatus ?? null,
      self: Boolean(attendee.self),
    })),
    organizer: item.organizer ?? null,
    creator: item.creator ?? null,
  }
}

function sourceMarker(calendarId: string, eventId: string) {
  return `${SOURCE}:${calendarId}:${eventId}`
}

function parseJsonList(value: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
  } catch {
    return []
  }
}

function normalizeBackfillDays(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BACKFILL_DAYS
  const days = Math.round(value)
  if (days < 1) return DEFAULT_BACKFILL_DAYS
  return Math.min(days, MAX_BACKFILL_DAYS)
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}
