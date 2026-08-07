import { createHmac, randomBytes } from "crypto"
import { decryptNullable, encryptNullable } from "@life-os/db/crypto"
import { createReviewItem } from "@life-os/domain"
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
// How far ahead a full (non-incremental) sync pulls. singleEvents=true expands
// recurring meetings into instances, so this window is the dominant cost of a
// first sync. Manual sync keeps a wide horizon; the auto-sync cron uses a tight
// window so it always finishes fast and can establish a syncToken — after which
// incremental sync (change-only) keeps everything current regardless of window.
const DEFAULT_FORWARD_DAYS = 365
// The cron re-scans this window every run (Google won't issue an incremental
// syncToken for a time-bounded query, so each run is a fresh windowed scan). It
// must be small enough to finish inside the function timeout given remote-DB
// write latency. A tight near-term window every 30 min keeps the upcoming week
// fresh; full-history backfill stays the manual Sync button's job.
const CRON_BACKFILL_DAYS = 1
const CRON_FORWARD_DAYS = 7
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

type GoogleCalendarListEntry = {
  id: string
  summary?: string
  description?: string
  primary?: boolean
  accessRole?: "freeBusyReader" | "reader" | "writer" | "owner"
  backgroundColor?: string
  foregroundColor?: string
  hidden?: boolean
  deleted?: boolean
}

type CalendarListResponse = {
  items?: GoogleCalendarListEntry[]
  nextPageToken?: string
}

type CalendarEventMetadata = {
  htmlLink?: string | null
  location?: string | null
  start?: { dateTime?: string; date?: string; timeZone?: string } | null
  end?: { dateTime?: string; date?: string; timeZone?: string } | null
  attendees?: { email?: string | null; displayName?: string | null; responseStatus?: string | null; self?: boolean }[]
  organizer?: { email?: string; displayName?: string; self?: boolean } | null
  creator?: { email?: string; displayName?: string; self?: boolean } | null
}

export function googleCalendarConfigured() {
  return Boolean(calendarClientId() && calendarClientSecret())
}

export async function googleCalendarStatus(actor: AccessActor) {
  const connections = await db.calendarConnection.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    orderBy: [{ status: "asc" }, { calendarSummary: "asc" }],
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

  const credential = await calendarCredential(actor.workspaceId)
  let availableCalendars: Array<ReturnType<typeof presentCalendarListEntry> & { selected: boolean }> = []
  let discoveryError: string | null = null

  if (credential) {
    try {
      const accessToken = await usableAccessToken(decryptedCredential(credential))
      const selectedIds = new Set(connections.filter(connection => connection.status === "active").map(connection => connection.calendarId))
      availableCalendars = (await fetchCalendarList(accessToken)).map(entry => ({
        ...presentCalendarListEntry(entry),
        selected: selectedIds.has(normalizedCalendarId(entry)),
      }))
    } catch (error) {
      discoveryError = error instanceof Error ? error.message : "Could not load Google calendars"
    }
  }

  const presentedConnections = connections.map(connection => ({
    ...connection,
    eventCount: connection._count.eventLinks,
    _count: undefined,
  }))

  return {
    configured: googleCalendarConfigured(),
    redirectUri: googleCalendarRedirectUri(null),
    expectedAccountEmail: calendarAccountEmail(),
    connection: presentedConnections[0] ?? null,
    connections: presentedConnections,
    availableCalendars,
    discoveryError,
  }
}

export async function googleCalendarTrace(actor: AccessActor, options: { limit?: number } = {}) {
  const limit = normalizeTraceLimit(options.limit)
  const connections = await db.calendarConnection.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    orderBy: { calendarSummary: "asc" },
    select: { id: true, calendarId: true, accountEmail: true, calendarSummary: true },
  })

  const runs = await db.auditLog.findMany({
    where: { workspaceId: actor.workspaceId, action: "calendar.sync" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, actorLabel: true, metadata: true },
  })

  const links = connections.length ? await db.calendarEventLink.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google", connectionId: { in: connections.map(connection => connection.id) } },
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
    connection: connections[0] ?? null,
    connections,
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
  const expectedEmail = calendarAccountEmail()
  if (expectedEmail) params.set("login_hint", expectedEmail)
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export async function handleGoogleCalendarCallback(input: { code: string; state: string; origin: string }) {
  const state = verifyState(input.state)
  const token = await exchangeCode(input.code, googleCalendarRedirectUri(input.origin))
  if (!token.refresh_token) {
    throw badRequest("Google did not return a refresh token. Reconnect Calendar and approve offline access.")
  }

  const accountEmail = await fetchGoogleAccountEmail(token.access_token)
  assertExpectedCalendarAccount(accountEmail)
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

  await db.calendarConnection.updateMany({
    where: {
      workspaceId: state.workspaceId,
      provider: "google",
      id: { not: connection.id },
    },
    data: {
      userId: state.userId,
      accountEmail,
      accessTokenEncrypted: encryptNullable(token.access_token),
      refreshTokenEncrypted: encryptNullable(token.refresh_token),
      expiresAt,
      scope: token.scope ?? CALENDAR_SCOPE,
      lastError: null,
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

export async function saveGoogleCalendarSelection(actor: AccessActor, calendarIds: string[]) {
  const credential = await calendarCredential(actor.workspaceId)
  if (!credential) throw notFound("Google Calendar is not connected")

  const accessToken = await usableAccessToken(decryptedCredential(credential))
  const calendars = await fetchCalendarList(accessToken)
  const availableById = new Map(calendars.map(calendar => [normalizedCalendarId(calendar), calendar]))
  const selectedIds = [...new Set(calendarIds.map(value => value.trim()).filter(Boolean))]
  if (selectedIds.length > 100) throw badRequest("Choose no more than 100 calendars")

  const unavailable = selectedIds.filter(calendarId => !availableById.has(calendarId))
  if (unavailable.length) throw forbidden("One or more calendars are not available to this Google account", { calendarIds: unavailable })

  const refreshedCredential = await db.calendarConnection.findUnique({ where: { id: credential.id } })
  if (!refreshedCredential) throw notFound("Google Calendar connection was removed")

  const existing = await db.calendarConnection.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    select: { id: true, calendarId: true },
  })
  const selectedSet = new Set(selectedIds)

  await db.$transaction([
    ...existing.map(connection => db.calendarConnection.update({
      where: { id: connection.id },
      data: { status: selectedSet.has(connection.calendarId) ? "active" : "inactive" },
    })),
    ...selectedIds.map(calendarId => {
      const calendar = availableById.get(calendarId)!
      return db.calendarConnection.upsert({
        where: {
          workspaceId_provider_calendarId: {
            workspaceId: actor.workspaceId,
            provider: "google",
            calendarId,
          },
        },
        update: {
          userId: actor.userId,
          status: "active",
          accountEmail: refreshedCredential.accountEmail,
          calendarSummary: calendar.summary ?? calendar.id,
          accessTokenEncrypted: refreshedCredential.accessTokenEncrypted,
          refreshTokenEncrypted: refreshedCredential.refreshTokenEncrypted,
          expiresAt: refreshedCredential.expiresAt,
          scope: refreshedCredential.scope,
          lastError: null,
        },
        create: {
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          provider: "google",
          status: "active",
          accountEmail: refreshedCredential.accountEmail,
          calendarId,
          calendarSummary: calendar.summary ?? calendar.id,
          accessTokenEncrypted: refreshedCredential.accessTokenEncrypted,
          refreshTokenEncrypted: refreshedCredential.refreshTokenEncrypted,
          expiresAt: refreshedCredential.expiresAt,
          scope: refreshedCredential.scope,
        },
      })
    }),
  ])

  await auditAction({
    actor: actor.actor,
    action: "calendar.connect",
    targetType: "calendarConnection",
    targetId: credential.id,
    metadata: { provider: "google", mode: "calendar-selection", calendarIds: selectedIds },
  })

  return googleCalendarStatus(actor)
}

export async function resetGoogleCalendarImport(actor: AccessActor) {
  const connections = await db.calendarConnection.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    include: { eventLinks: { select: { id: true, eventId: true } } },
  })
  if (!connections.length) {
    return { deletedInteractions: 0, deletedEvents: 0, deletedLinks: 0, disconnected: false }
  }

  const eventIds = [...new Set(connections.flatMap(connection => connection.eventLinks).map(link => link.eventId).filter((id): id is string => Boolean(id)))]

  const result = await db.$transaction(async tx => {
    const deletedInteractions = eventIds.length
      ? await tx.interaction.deleteMany({
        where: {
          workspaceId: actor.workspaceId,
          type: "calendar",
          eventId: { in: eventIds },
          notes: { contains: SOURCE },
        },
      })
      : { count: 0 }

    const deletedLinks = await tx.calendarEventLink.deleteMany({
      where: { workspaceId: actor.workspaceId, provider: "google" },
    })

    const deletedEvents = eventIds.length
      ? await tx.event.deleteMany({
        where: {
          workspaceId: actor.workspaceId,
          id: { in: eventIds },
          type: "calendar",
          metadata: { contains: `"source":"${SOURCE}"` },
          interactions: { none: {} },
        },
      })
      : { count: 0 }

    await tx.calendarConnection.deleteMany({ where: { workspaceId: actor.workspaceId, provider: "google" } })

    return {
      deletedInteractions: deletedInteractions.count,
      deletedEvents: deletedEvents.count,
      deletedLinks: deletedLinks.count,
      disconnected: true,
    }
  })

  await auditAction({
    actor: actor.actor,
    action: "calendar.sync",
    targetType: "calendarConnection",
    targetId: connections[0].id,
    metadata: { provider: "google", mode: "calendar-reset", connectionCount: connections.length, ...result },
  })

  return result
}

type SyncOptions = {
  backfillDays?: number | null
}

type SyncStats = {
  calendarId: string
  calendarSummary: string | null
  createdPlans: number
  updatedPlans: number
  cancelled: number
  fetched: number
  batches: number
  backfillDays: number
  incremental: boolean
  error: string | null
}

type SyncConnection = {
  id: string
  calendarId: string
  calendarSummary: string | null
  accessTokenEncrypted: string | null
  refreshTokenEncrypted: string | null
  syncTokenEncrypted: string | null
  expiresAt: Date | null
}

// Per-connection sync only needs the workspace and an audit actor — not a full
// AccessActor. Narrowing to this lets the cron path drive the exact same sync
// with a system actor and no user session. AccessActor structurally satisfies it.
type SyncActor = { workspaceId: string; actor: DomainActor }

export async function syncGoogleCalendar(actor: AccessActor, options: SyncOptions = {}) {
  const connections = await db.calendarConnection.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google", status: "active" },
    orderBy: { calendarSummary: "asc" },
  })
  if (!connections.length) throw notFound("Choose at least one Google Calendar to sync")

  const backfillDays = normalizeBackfillDays(options.backfillDays)
  const peopleByEmail = await peopleEmailIndex(actor.workspaceId)
  const calendars: SyncStats[] = []

  for (const connection of connections) {
    calendars.push(await syncGoogleCalendarConnection(actor, connection, peopleByEmail, backfillDays))
  }

  return {
    calendars,
    totals: calendars.reduce((totals, calendar) => ({
      createdPlans: totals.createdPlans + calendar.createdPlans,
      updatedPlans: totals.updatedPlans + calendar.updatedPlans,
      cancelled: totals.cancelled + calendar.cancelled,
      fetched: totals.fetched + calendar.fetched,
      batches: totals.batches + calendar.batches,
      failedCalendars: totals.failedCalendars + (calendar.error ? 1 : 0),
    }), {
      createdPlans: 0,
      updatedPlans: 0,
      cancelled: 0,
      fetched: 0,
      batches: 0,
      failedCalendars: 0,
    }),
    backfillDays,
  }
}

// Session-less sync for the auto-sync cron: refreshes every active Google
// Calendar connection across all workspaces using stored (encrypted) tokens.
// A per-calendar failure is captured in its SyncStats.error and never aborts the
// rest — one revoked account can't stall everyone's sync.
export async function syncAllGoogleCalendars(options: SyncOptions = {}) {
  const connections = await db.calendarConnection.findMany({
    where: { provider: "google", status: "active" },
    orderBy: [{ workspaceId: "asc" }, { calendarSummary: "asc" }],
  })

  const byWorkspace = new Map<string, typeof connections>()
  for (const connection of connections) {
    const list = byWorkspace.get(connection.workspaceId) ?? []
    list.push(connection)
    byWorkspace.set(connection.workspaceId, list)
  }

  // Tight window: the cron catches recent/near-future changes fast. Once a
  // connection has synced once (syncToken saved), later runs are incremental and
  // the window no longer applies. Full-history backfill stays the manual Sync.
  const backfillDays = options.backfillDays != null ? normalizeBackfillDays(options.backfillDays) : CRON_BACKFILL_DAYS
  const results: Array<{ workspaceId: string; calendars: SyncStats[] }> = []

  for (const [workspaceId, workspaceConnections] of byWorkspace) {
    const actor: SyncActor = {
      workspaceId,
      actor: { type: "system", id: "calendar-cron", label: "Calendar auto-sync", workspaceId },
    }
    const peopleByEmail = await peopleEmailIndex(workspaceId)
    const calendars: SyncStats[] = []
    for (const connection of workspaceConnections) {
      calendars.push(await syncGoogleCalendarConnection(actor, connection, peopleByEmail, backfillDays, CRON_FORWARD_DAYS))
    }
    results.push({ workspaceId, calendars })
  }

  return {
    workspaces: results.length,
    connections: connections.length,
    results,
  }
}

async function syncGoogleCalendarConnection(
  actor: SyncActor,
  connection: SyncConnection,
  peopleByEmail: Map<string, { id: string; first: string; last: string }>,
  backfillDays: number,
  forwardDays: number = DEFAULT_FORWARD_DAYS,
) {
  const syncToken = decryptNullable(connection.syncTokenEncrypted)
  const stats: SyncStats = {
    calendarId: connection.calendarId,
    calendarSummary: connection.calendarSummary,
    createdPlans: 0,
    updatedPlans: 0,
    cancelled: 0,
    fetched: 0,
    batches: 0,
    backfillDays,
    incremental: Boolean(syncToken),
    error: null,
  }

  try {
    if (!connection.refreshTokenEncrypted && !connection.accessTokenEncrypted) {
      throw badRequest("Google Calendar connection has no usable token")
    }
    const accessToken = await usableAccessToken(decryptedCredential(connection))
    const listed = await syncEventPages(accessToken, {
      calendarId: connection.calendarId,
      syncToken,
      backfillDays,
      forwardDays,
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
        stats.createdPlans += result.createdPlans
        stats.updatedPlans += result.updatedPlans
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

    return stats
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Calendar sync failed"
    await db.calendarConnection.update({ where: { id: connection.id }, data: { lastError: message } })
    return { ...stats, error: message }
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
  let createdPlans = 0
  let updatedPlans = 0
  let cancelled = 0
  let fetched = 0

  const toUpsert: GoogleCalendarEvent[] = []
  for (const item of input.items) {
    if (!item.id) continue
    fetched += 1
    if (item.status === "cancelled") {
      cancelled += await markCancelled(input.connectionId, input.workspaceId, input.calendarId, item.id)
      continue
    }
    toUpsert.push(item)
  }

  // Each upsert is several sequential round-trips to a remote (Turso) DB, so
  // processing a batch one event at a time is latency-bound and can blow past the
  // function timeout on a busy calendar. Events in a batch are independent
  // (distinct externalEventId), so run the batch concurrently — the per-event
  // round-trips overlap instead of summing.
  const results = await Promise.all(
    toUpsert.map(item => upsertCalendarEvent({
      actor: input.actor,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      calendarId: input.calendarId,
      item,
      peopleByEmail: input.peopleByEmail,
    })),
  )
  for (const result of results) {
    if (result.createdPlan) createdPlans += 1
    else updatedPlans += 1
  }

  return { createdPlans, updatedPlans, cancelled, fetched }
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
  if (!start) return { createdPlan: false }
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
    include: { plan: true },
  })

  const externalInstanceId = `${SOURCE}:${input.calendarId}:${input.item.id}`
  let planId = link?.planId ?? null
  let createdPlan = false
  if (planId) {
    await db.plan.update({
      where: { id: planId },
      data: {
        text: input.item.summary?.trim() || "Untitled Google Calendar event",
        scheduledStart: start,
        scheduledEnd: end ?? null,
        successSignals: JSON.stringify(metadata),
      },
    })
  } else {
    const existingPlan = await db.plan.findUnique({ where: { externalInstanceId }, select: { id: true } })
    const plan = existingPlan ?? await db.plan.create({
      data: {
        workspaceId: input.workspaceId,
        text: input.item.summary?.trim() || "Untitled Google Calendar event",
        scheduledStart: start,
        scheduledEnd: end ?? null,
        externalSource: SOURCE,
        externalInstanceId,
        reconciliationStatus: link?.eventId ? "happened" : "pending",
        reconciledAt: link?.eventId ? new Date() : null,
        status: link?.eventId ? "completed" : "active",
        successSignals: JSON.stringify(metadata),
      },
      select: { id: true },
    })
    planId = plan.id
    createdPlan = !existingPlan
    if (createdPlan) {
      await auditAction({ actor: input.actor, action: "plan.create", targetType: "plan", targetId: plan.id, metadata: { source: SOURCE, externalEventId: input.item.id } })
    }
  }

  // Compatibility bridge: old syncs wrote provider occurrences directly as
  // Events. Preserve those records and link the new prediction to them rather
  // than presenting the occurrence for review or creating a duplicate Event.
  if (link?.eventId) {
    await db.event.updateMany({
      where: { id: link.eventId, workspaceId: input.workspaceId, sourcePlanId: null },
      data: { sourcePlanId: planId },
    })
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
    update: { planId, iCalUID: input.item.iCalUID ?? null, status: input.item.status ?? "confirmed", lastSeenAt: new Date() },
    create: {
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      provider: "google",
      calendarId: input.calendarId,
      externalEventId: input.item.id,
      iCalUID: input.item.iCalUID ?? null,
      planId,
      status: input.item.status ?? "confirmed",
      lastSeenAt: new Date(),
    },
  })

  if (!link?.eventId) {
    await createReviewItem({
      workspaceId: input.workspaceId,
      source: "calendar_reconciliation",
      sourceId: planId,
      itemType: "event",
      command: "calendar_reconciliation.reconcile",
      commandInput: { planId, action: "happened" },
      targetType: "Plan",
      targetId: planId,
      evidence: {
        title: input.item.summary?.trim() || "Untitled Google Calendar event",
        scheduledStart: start.toISOString(),
        scheduledEnd: end?.toISOString() ?? null,
        externalEventId: input.item.id,
        calendarId: input.calendarId,
      },
      riskTier: "review",
      priority: 2,
    })
  }

  const matchedPeople = matchedAttendees(input.item, input.peopleByEmail)
  await db.$transaction(async tx => {
    await tx.planExpectedPerson.deleteMany({ where: { planId } })
    if (matchedPeople.length) {
      await tx.planExpectedPerson.createMany({
        data: matchedPeople.map(person => ({
          planId: planId!,
          personId: person.id,
          workspaceId: input.workspaceId,
        })),
      })
    }
  })

  return { createdPlan }
}

async function peopleEmailIndex(workspaceId: string) {
  const byEmail = new Map<string, { id: string; first: string; last: string }>()
  let cursor: string | undefined
  do {
    const rows = await db.person.findMany({
      where: { workspaceId },
      select: { id: true, first: true, last: true, emails: true },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    for (const row of rows) {
      for (const email of parseJsonList(row.emails)) byEmail.set(email.toLowerCase(), row)
    }
    cursor = rows.length === 500 ? rows.at(-1)?.id : undefined
  } while (cursor)
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
    select: { id: true, planId: true, plan: { select: { fulfilledBy: { select: { id: true } } } } },
  })
  if (!link) return 0
  await db.$transaction([
    db.calendarEventLink.update({ where: { id: link.id }, data: { connectionId, status: "cancelled", lastSeenAt: new Date() } }),
    ...(link.planId && !link.plan?.fulfilledBy ? [db.plan.update({
      where: { id: link.planId },
      data: { status: "abandoned", reconciliationStatus: "cancelled", reconciledAt: new Date() },
    })] : []),
  ])
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
    forwardDays: number
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
      params.set("timeMax", new Date(now + input.forwardDays * 24 * 60 * 60 * 1000).toISOString())
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
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    console.error("[google-calendar] token exchange failed", { status: res.status, body, redirectUri })
    throw new Error(`Google token exchange failed (${res.status}): ${body}`)
  }
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

async function fetchCalendarList(accessToken: string) {
  const calendars: GoogleCalendarListEntry[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({ maxResults: "250", showDeleted: "false", showHidden: "true" })
    if (pageToken) params.set("pageToken", pageToken)
    const res = await googleFetch(`${GOOGLE_CALENDAR_BASE}/users/me/calendarList?${params}`, accessToken)
    if (!res.ok) throw new Error(`Google Calendar list failed (${res.status})`)
    const data = await res.json() as CalendarListResponse
    calendars.push(...(data.items ?? []).filter(calendar => !calendar.deleted))
    pageToken = data.nextPageToken
  } while (pageToken)

  return calendars.sort((a, b) => {
    if (a.primary) return -1
    if (b.primary) return 1
    return (a.summary ?? a.id).localeCompare(b.summary ?? b.id)
  })
}

function normalizedCalendarId(calendar: GoogleCalendarListEntry) {
  return calendar.primary ? "primary" : calendar.id
}

function presentCalendarListEntry(calendar: GoogleCalendarListEntry) {
  return {
    id: normalizedCalendarId(calendar),
    googleCalendarId: calendar.id,
    summary: calendar.summary ?? calendar.id,
    description: calendar.description ?? null,
    primary: Boolean(calendar.primary),
    accessRole: calendar.accessRole ?? null,
    backgroundColor: calendar.backgroundColor ?? null,
    foregroundColor: calendar.foregroundColor ?? null,
    hidden: Boolean(calendar.hidden),
  }
}

async function calendarCredential(workspaceId: string) {
  return db.calendarConnection.findFirst({
    where: {
      workspaceId,
      provider: "google",
      OR: [
        { refreshTokenEncrypted: { not: null } },
        { accessTokenEncrypted: { not: null } },
      ],
    },
    orderBy: [{ calendarId: "asc" }, { updatedAt: "desc" }],
  })
}

function decryptedCredential(connection: {
  id: string
  accessTokenEncrypted: string | null
  refreshTokenEncrypted: string | null
  expiresAt: Date | null
}) {
  return {
    id: connection.id,
    accessToken: decryptNullable(connection.accessTokenEncrypted),
    refreshToken: decryptNullable(connection.refreshTokenEncrypted),
    expiresAt: connection.expiresAt,
  }
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

function calendarAccountEmail() {
  return (process.env.GOOGLE_CALENDAR_ACCOUNT_EMAIL || "jdf247@gmail.com").trim().toLowerCase()
}

function assertExpectedCalendarAccount(accountEmail: string | null) {
  const expected = calendarAccountEmail()
  if (!expected) return
  const actual = accountEmail?.trim().toLowerCase() ?? null
  if (actual !== expected) {
    throw badRequest(`Connect ${expected} to Calendar, not ${actual ?? "an unknown Google account"}.`, {
      expectedAccountEmail: expected,
      accountEmail: actual,
    })
  }
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
  const parsed = parseJsonObject(value ?? null) as CalendarEventMetadata | null
  return parsed ?? {}
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
