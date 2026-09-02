import { createHmac, randomBytes } from "crypto";
import { decryptNullable, encryptNullable } from "@life-os/db/crypto";
import {
  createReviewItem,
  declinedAttendeeEmails,
  participatingAttendeeEmails,
} from "@life-os/domain";
import { db } from "@/lib/db";
import { badRequest, forbidden, notFound } from "@/server/api/errors";
import { auditAction, type DomainActor } from "./audit";
import type { AccessActor } from "./access";
import {
  DUPLICATE_OCCURRENCE_WINDOW_MS,
  mapPool,
  prioritizeCalendarConnections,
  sameCalendarOccurrence,
  walkEventPages,
  withCalendarDbRetry,
} from "./google-calendar-sync";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const SOURCE = "google-calendar";
const DEFAULT_BACKFILL_DAYS = 180;
const MAX_BACKFILL_DAYS = 3650;
// There is no forward window any more, and that is the point. Every sync is
// either an unwindowed bootstrap walk (which earns a syncToken) or a true
// incremental sync against that token — neither is bounded by a date range, so
// an event five years out is as visible as one tomorrow.
//
// The previous design set timeMin/timeMax on every request, which suppresses
// Google's nextSyncToken. The token was therefore never obtained, the promised
// "incremental sync keeps everything current regardless of window" never
// activated, and the cron sat at a 7-day forward horizon indefinitely.
//
// backfillDays now bounds only how much HISTORY the bootstrap ingests, never
// how far ahead it can see.
const CRON_BACKFILL_DAYS = 180;
// Per-connection work budget. On expiry a bootstrap walk parks its page
// cursor and resumes next run, so a large calendar converges across runs
// instead of timing out on every one.
const SYNC_TIME_BUDGET_MS = 200_000;
// Whole-invocation ceiling, under the route's maxDuration of 300s. Multiple
// connections share this — without it, two calendars that both need their
// full SYNC_TIME_BUDGET_MS (e.g. two still mid-bootstrap) sum to more than
// Vercel's limit and Vercel kills the function outright (504
// FUNCTION_INVOCATION_TIMEOUT) before the in-progress connection's DB write
// lands, so its cursor never advances and every run repeats the same work.
// 60s of headroom below the 300s cap covers DB/network overhead, response
// serialization after the last connection finishes, and the fact that the
// deadline is only checked once per onBatch (see walkEventPages) — a slow
// enough batch can still overrun this by seconds before the check fires.
const OVERALL_SYNC_DEADLINE_MS = 240_000;
// Below this much remaining budget, don't start another connection — not
// enough time left to make real progress, and a partial attempt still risks
// running past the overall deadline itself.
const MIN_CONNECTION_BUDGET_MS = 15_000;
// Every call to Google (event pages, token exchange, token refresh) used to
// have no timeout at all: a single stalled request could hang for the whole
// platform's 300s function ceiling, and the deadline checks above only run
// BETWEEN awaited fetches — they can't interrupt one already in flight. This
// is what actually caused every calendar-auto-sync run to fail with
// FUNCTION_INVOCATION_TIMEOUT instead of finishing gracefully within budget.
const GOOGLE_FETCH_TIMEOUT_MS = 30_000;
const GOOGLE_PAGE_SIZE = 100;
// The overall deadline is only checked once per batch (walkEventPages), so
// this also bounds how far a slow-enough batch can overrun it before the
// check gets a chance to fire. Smaller than it looks wasteful for: measured
// per-item cost during the 2026-08-27 incident was ~5s under contention, so
// a batch of 25 could overrun the deadline by ~30s+ before ever checking.
const DB_BATCH_SIZE = 10;
// Each event upsert used to open an interactive Prisma transaction (default
// maxWait 2s) and 25 of those ran at once. After the two small personal
// calendars finished, Qin and Sightmachine consistently died with
// "Unable to start a transaction in the given time." Keep overlap for Turso
// latency, but never enough concurrent transactions to stall the rest.
const UPSERT_CONCURRENCY = 4;
const CALENDAR_TX = { maxWait: 10_000, timeout: 20_000 } as const;

type OAuthState = {
  workspaceId: string;
  userId: string;
  nonce: string;
  returnTo: string;
};

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleCalendarEvent = {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: {
    email?: string;
    displayName?: string;
    self?: boolean;
    responseStatus?: string;
  }[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  creator?: { email?: string; displayName?: string; self?: boolean };
  updated?: string;
};

type EventsListResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
  summary?: string;
};

type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  description?: string;
  primary?: boolean;
  accessRole?: "freeBusyReader" | "reader" | "writer" | "owner";
  backgroundColor?: string;
  foregroundColor?: string;
  hidden?: boolean;
  deleted?: boolean;
};

type CalendarListResponse = {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
};

type CalendarEventMetadata = {
  htmlLink?: string | null;
  location?: string | null;
  start?: { dateTime?: string; date?: string; timeZone?: string } | null;
  end?: { dateTime?: string; date?: string; timeZone?: string } | null;
  attendees?: {
    email?: string | null;
    displayName?: string | null;
    responseStatus?: string | null;
    self?: boolean;
  }[];
  organizer?: { email?: string; displayName?: string; self?: boolean } | null;
  creator?: { email?: string; displayName?: string; self?: boolean } | null;
};

export function googleCalendarConfigured() {
  return Boolean(calendarClientId() && calendarClientSecret());
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
      ownerAttendanceDefault: true,
      scope: true,
      lastSyncedAt: true,
      lastError: true,
      updatedAt: true,
      _count: { select: { eventLinks: true } },
    },
  });

  const credential = await calendarCredential(actor.workspaceId);
  let availableCalendars: Array<
    ReturnType<typeof presentCalendarListEntry> & { selected: boolean }
  > = [];
  let discoveryError: string | null = null;

  if (credential) {
    try {
      const accessToken = await usableAccessToken(
        decryptedCredential(credential),
      );
      const selectedIds = new Set(
        connections
          .filter((connection) => connection.status === "active")
          .map((connection) => connection.calendarId),
      );
      availableCalendars = (await fetchCalendarList(accessToken)).map(
        (entry) => ({
          ...presentCalendarListEntry(entry),
          selected: selectedIds.has(normalizedCalendarId(entry)),
        }),
      );
    } catch (error) {
      discoveryError =
        error instanceof Error
          ? error.message
          : "Could not load Google calendars";
    }
  }

  const presentedConnections = connections.map((connection) => ({
    ...connection,
    eventCount: connection._count.eventLinks,
    _count: undefined,
  }));

  return {
    configured: googleCalendarConfigured(),
    redirectUri: googleCalendarRedirectUri(null),
    expectedAccountEmail: calendarAccountEmail(),
    connection: presentedConnections[0] ?? null,
    connections: presentedConnections,
    availableCalendars,
    discoveryError,
  };
}

export async function updateCalendarOwnerAttendanceDefault(
  actor: AccessActor,
  connectionId: string,
  attendance: "going" | "not_going",
) {
  const connection = await db.calendarConnection.findFirst({
    where: { id: connectionId, workspaceId: actor.workspaceId, provider: "google" },
    select: { id: true, status: true },
  });
  if (!connection) throw notFound("Calendar not found");
  await db.calendarConnection.update({
    where: { id: connection.id },
    data: { ownerAttendanceDefault: attendance },
  });
  await auditAction({
    actor: actor.actor,
    action: "calendar.attendance_default",
    targetType: "calendarConnection",
    targetId: connection.id,
    metadata: { ownerAttendanceDefault: attendance },
  });
  return googleCalendarStatus(actor);
}

export async function googleCalendarTrace(
  actor: AccessActor,
  options: { limit?: number } = {},
) {
  const limit = normalizeTraceLimit(options.limit);
  const connections = await db.calendarConnection.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    orderBy: { calendarSummary: "asc" },
    select: {
      id: true,
      calendarId: true,
      accountEmail: true,
      calendarSummary: true,
    },
  });

  const runs = await db.auditLog.findMany({
    where: { workspaceId: actor.workspaceId, action: "calendar.sync" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, actorLabel: true, metadata: true },
  });

  const links = connections.length
    ? await db.calendarEventLink.findMany({
        where: {
          workspaceId: actor.workspaceId,
          provider: "google",
          connectionId: { in: connections.map((connection) => connection.id) },
        },
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
                  person: {
                    select: { id: true, first: true, last: true, emails: true },
                  },
                },
              },
            },
          },
        },
      })
    : [];

  return {
    connection: connections[0] ?? null,
    connections,
    runs: runs.map((run) => ({
      id: run.id,
      createdAt: run.createdAt,
      actorLabel: run.actorLabel,
      metadata: parseJsonObject(run.metadata),
    })),
    events: links.map((link) => {
      const metadata = parseCalendarMetadata(link.event?.metadata);
      const marker = sourceMarker(link.calendarId, link.externalEventId);
      const linkedInteractions = (link.event?.interactions ?? [])
        .filter(
          (interaction) =>
            interaction.person && (interaction.notes ?? "").includes(marker),
        )
        .map((interaction) => ({
          id: interaction.id,
          createdAt: interaction.createdAt,
          timestamp: interaction.timestamp,
          summary: interaction.summary,
          person: interaction.person
            ? {
                id: interaction.person.id,
                name: personName(interaction.person),
                emails: parseJsonList(interaction.person.emails),
              }
            : null,
        }));

      return {
        id: link.id,
        status: link.status,
        calendarId: link.calendarId,
        externalEventId: link.externalEventId,
        iCalUID: link.iCalUID,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
        lastSeenAt: link.lastSeenAt,
        event: link.event
          ? {
              id: link.event.id,
              name: link.event.name,
              timestamp: link.event.timestamp,
              createdAt: link.event.createdAt,
              htmlLink: metadata.htmlLink ?? null,
              location: metadata.location ?? null,
              attendeeCount: metadata.attendees?.length ?? 0,
              attendees: (metadata.attendees ?? []).slice(0, 12),
            }
          : null,
        linkedPeople: linkedInteractions,
      };
    }),
  };
}

export function googleCalendarAuthUrl(
  actor: AccessActor,
  origin: string,
  returnTo = "/admin",
) {
  const clientId = calendarClientId();
  if (!clientId || !calendarClientSecret())
    throw badRequest("Google Calendar OAuth is not configured");
  const redirectUri = googleCalendarRedirectUri(origin);
  const state = signState({
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    nonce: randomBytes(12).toString("hex"),
    returnTo,
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  const expectedEmail = calendarAccountEmail();
  if (expectedEmail) params.set("login_hint", expectedEmail);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function handleGoogleCalendarCallback(input: {
  code: string;
  state: string;
  origin: string;
}) {
  const state = verifyState(input.state);
  const token = await exchangeCode(
    input.code,
    googleCalendarRedirectUri(input.origin),
  );
  if (!token.refresh_token) {
    throw badRequest(
      "Google did not return a refresh token. Reconnect Calendar and approve offline access.",
    );
  }

  const accountEmail = await fetchGoogleAccountEmail(token.access_token);
  assertExpectedCalendarAccount(accountEmail);
  const calendar = await fetchPrimaryCalendar(token.access_token);
  const calendarId = "primary";
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;

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
  });

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
  });
  await syncCalendarConnectionMirrors(state.workspaceId);

  await auditAction({
    actor: { type: "user", id: state.userId, workspaceId: state.workspaceId },
    action: "calendar.connect",
    targetType: "calendarConnection",
    targetId: connection.id,
    metadata: { provider: "google", accountEmail, calendarId },
  });

  return { returnTo: state.returnTo, connectionId: connection.id };
}

export async function saveGoogleCalendarSelection(
  actor: AccessActor,
  calendarIds: string[],
) {
  const credential = await calendarCredential(actor.workspaceId);
  if (!credential) throw notFound("Google Calendar is not connected");

  const accessToken = await usableAccessToken(decryptedCredential(credential));
  const calendars = await fetchCalendarList(accessToken);
  const availableById = new Map(
    calendars.map((calendar) => [normalizedCalendarId(calendar), calendar]),
  );
  const selectedIds = [
    ...new Set(calendarIds.map((value) => value.trim()).filter(Boolean)),
  ];
  if (selectedIds.length > 100)
    throw badRequest("Choose no more than 100 calendars");

  const unavailable = selectedIds.filter(
    (calendarId) => !availableById.has(calendarId),
  );
  if (unavailable.length)
    throw forbidden(
      "One or more calendars are not available to this Google account",
      { calendarIds: unavailable },
    );

  const refreshedCredential = await db.calendarConnection.findUnique({
    where: { id: credential.id },
  });
  if (!refreshedCredential)
    throw notFound("Google Calendar connection was removed");

  const existing = await db.calendarConnection.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    select: { id: true, calendarId: true },
  });
  const selectedSet = new Set(selectedIds);

  await db.$transaction([
    ...existing.map((connection) =>
      db.calendarConnection.update({
        where: { id: connection.id },
        data: {
          status: selectedSet.has(connection.calendarId)
            ? "active"
            : "inactive",
        },
      }),
    ),
    ...selectedIds.map((calendarId) => {
      const calendar = availableById.get(calendarId)!;
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
      });
    }),
  ]);
  await syncCalendarConnectionMirrors(actor.workspaceId);

  await auditAction({
    actor: actor.actor,
    action: "calendar.connect",
    targetType: "calendarConnection",
    targetId: credential.id,
    metadata: {
      provider: "google",
      mode: "calendar-selection",
      calendarIds: selectedIds,
    },
  });

  return googleCalendarStatus(actor);
}

export async function resetGoogleCalendarImport(actor: AccessActor) {
  const connections = await db.calendarConnection.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    include: { eventLinks: { select: { id: true, eventId: true } } },
  });
  if (!connections.length) {
    return {
      deletedInteractions: 0,
      deletedEvents: 0,
      deletedLinks: 0,
      disconnected: false,
    };
  }

  const eventIds = [
    ...new Set(
      connections
        .flatMap((connection) => connection.eventLinks)
        .map((link) => link.eventId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const result = await db.$transaction(async (tx) => {
    const deletedInteractions = eventIds.length
      ? await tx.interaction.deleteMany({
          where: {
            workspaceId: actor.workspaceId,
            type: "calendar",
            eventId: { in: eventIds },
            notes: { contains: SOURCE, mode: "insensitive" as const },
          },
        })
      : { count: 0 };

    const deletedLinks = await tx.calendarEventLink.deleteMany({
      where: { workspaceId: actor.workspaceId, provider: "google" },
    });

    const deletedEvents = eventIds.length
      ? await tx.event.deleteMany({
          where: {
            workspaceId: actor.workspaceId,
            id: { in: eventIds },
            type: "calendar",
            metadata: {
              contains: `"source":"${SOURCE}"`,
              mode: "insensitive" as const,
            },
            interactions: { none: {} },
          },
        })
      : { count: 0 };

    await tx.calendarConnection.deleteMany({
      where: { workspaceId: actor.workspaceId, provider: "google" },
    });
    await tx.connection.deleteMany({
      where: {
        workspaceId: actor.workspaceId,
        sourceTable: "CalendarConnection",
        sourceId: { in: connections.map((connection) => connection.id) },
      },
    });

    return {
      deletedInteractions: deletedInteractions.count,
      deletedEvents: deletedEvents.count,
      deletedLinks: deletedLinks.count,
      disconnected: true,
    };
  });

  await auditAction({
    actor: actor.actor,
    action: "calendar.sync",
    targetType: "calendarConnection",
    targetId: connections[0].id,
    metadata: {
      provider: "google",
      mode: "calendar-reset",
      connectionCount: connections.length,
      ...result,
    },
  });

  return result;
}

type SyncOptions = {
  backfillDays?: number | null;
};

type SyncStats = {
  calendarId: string;
  calendarSummary: string | null;
  createdPlans: number;
  updatedPlans: number;
  cancelled: number;
  fetched: number;
  batches: number;
  backfillDays: number;
  incremental: boolean;
  // True when the bootstrap walk hit its budget and parked a cursor: this
  // calendar is mid-bootstrap and will continue on the next run.
  bootstrapping: boolean;
  error: string | null;
};

type SyncConnection = {
  id: string;
  calendarId: string;
  calendarSummary: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  syncTokenEncrypted: string | null;
  fullSyncPageToken: string | null;
  expiresAt: Date | null;
};

// Per-connection sync only needs the workspace and an audit actor — not a full
// AccessActor. Narrowing to this lets the cron path drive the exact same sync
// with a system actor and no user session. AccessActor structurally satisfies it.
type SyncActor = { workspaceId: string; actor: DomainActor };

export async function syncGoogleCalendar(
  actor: AccessActor,
  options: SyncOptions = {},
) {
  const connections = prioritizeCalendarConnections(
    await db.calendarConnection.findMany({
      where: {
        workspaceId: actor.workspaceId,
        provider: "google",
        status: "active",
      },
    }),
  );
  if (!connections.length)
    throw notFound("Choose at least one Google Calendar to sync");

  const backfillDays = normalizeBackfillDays(options.backfillDays);
  const peopleByEmail = await peopleEmailIndex(actor.workspaceId);
  const calendars: SyncStats[] = [];
  // Same reasoning as syncAllGoogleCalendars: this loop can span several
  // calendars, and each one's own budget must not be allowed to sum past the
  // route's maxDuration.
  const overallDeadline = Date.now() + OVERALL_SYNC_DEADLINE_MS;

  for (const connection of connections) {
    if (overallDeadline - Date.now() < MIN_CONNECTION_BUDGET_MS) break;
    calendars.push(
      await syncGoogleCalendarConnection(
        actor,
        connection,
        peopleByEmail,
        backfillDays,
        overallDeadline,
      ),
    );
  }

  return {
    calendars,
    totals: calendars.reduce(
      (totals, calendar) => ({
        createdPlans: totals.createdPlans + calendar.createdPlans,
        updatedPlans: totals.updatedPlans + calendar.updatedPlans,
        cancelled: totals.cancelled + calendar.cancelled,
        fetched: totals.fetched + calendar.fetched,
        batches: totals.batches + calendar.batches,
        failedCalendars: totals.failedCalendars + (calendar.error ? 1 : 0),
      }),
      {
        createdPlans: 0,
        updatedPlans: 0,
        cancelled: 0,
        fetched: 0,
        batches: 0,
        failedCalendars: 0,
      },
    ),
    backfillDays,
  };
}

// Session-less sync for the auto-sync cron: refreshes every active Google
// Calendar connection across all workspaces using stored (encrypted) tokens.
// A per-calendar failure is captured in its SyncStats.error and never aborts the
// rest — one revoked account can't stall everyone's sync.
export async function syncAllGoogleCalendars(options: SyncOptions = {}) {
  const connections = await db.calendarConnection.findMany({
    where: { provider: "google", status: "active" },
  });

  const byWorkspace = new Map<string, typeof connections>();
  for (const connection of connections) {
    const list = byWorkspace.get(connection.workspaceId) ?? [];
    list.push(connection);
    byWorkspace.set(connection.workspaceId, list);
  }

  // Tight window: the cron catches recent/near-future changes fast. Once a
  // connection has synced once (syncToken saved), later runs are incremental and
  // the window no longer applies. Full-history backfill stays the manual Sync.
  const backfillDays =
    options.backfillDays != null
      ? normalizeBackfillDays(options.backfillDays)
      : CRON_BACKFILL_DAYS;
  const results: Array<{ workspaceId: string; calendars: SyncStats[] }> = [];
  // Shared across every connection in this invocation — see
  // OVERALL_SYNC_DEADLINE_MS. Connections are already prioritized
  // stalest-first, so whatever gets skipped here is exactly what leads
  // priority next run.
  const overallDeadline = Date.now() + OVERALL_SYNC_DEADLINE_MS;
  let skipped = 0;
  let budgetExhausted = false;

  for (const [workspaceId, workspaceConnections] of byWorkspace) {
    const actor: SyncActor = {
      workspaceId,
      actor: {
        type: "system",
        id: "calendar-cron",
        label: "Calendar auto-sync",
        workspaceId,
      },
    };
    const peopleByEmail = budgetExhausted
      ? new Map()
      : await peopleEmailIndex(workspaceId);
    const calendars: SyncStats[] = [];
    for (const connection of prioritizeCalendarConnections(
      workspaceConnections,
    )) {
      if (
        budgetExhausted ||
        overallDeadline - Date.now() < MIN_CONNECTION_BUDGET_MS
      ) {
        budgetExhausted = true;
        skipped += 1;
        continue;
      }
      calendars.push(
        await syncGoogleCalendarConnection(
          actor,
          connection,
          peopleByEmail,
          backfillDays,
          overallDeadline,
        ),
      );
    }
    results.push({ workspaceId, calendars });
  }

  return {
    workspaces: results.length,
    connections: connections.length,
    skipped,
    results,
  };
}

// How likely is it that this slot actually happened? Used to rank the queue and
// to let the existing "auto-approve high-confidence matches" rule act, which it
// could not while every item was created with a null confidence.
//
// The signals are the ones Google already gives us: accepting an invitation is
// the strongest, a cancelled event the weakest, and a solo hold in a calendar is
// the least evidence of anything.
function reconciliationConfidence(
  item: {
    status?: string;
    attendees?: { self?: boolean; responseStatus?: string | null }[];
  },
  _planId: string,
) {
  if (item.status === "cancelled") return 0.1;
  const attendees = item.attendees ?? [];
  const me = attendees.find((a) => a.self);
  if (me?.responseStatus === "accepted") return 0.95;
  if (me?.responseStatus === "declined") return 0.15;
  if (attendees.length > 1) return 0.7;
  return 0.5;
}

async function syncGoogleCalendarConnection(
  actor: SyncActor,
  connection: SyncConnection,
  peopleByEmail: Map<string, { id: string; first: string; last: string }>,
  backfillDays: number,
  overallDeadline: number,
) {
  const syncToken = decryptNullable(connection.syncTokenEncrypted);
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
    bootstrapping: false,
    error: null,
  };

  try {
    if (!connection.refreshTokenEncrypted && !connection.accessTokenEncrypted) {
      throw badRequest("Google Calendar connection has no usable token");
    }
    const accessToken = await usableAccessToken(
      decryptedCredential(connection),
    );
    const listed = await syncEventPages(accessToken, {
      calendarId: connection.calendarId,
      syncToken,
      resumePageToken: connection.fullSyncPageToken ?? null,
      // Bound what the bootstrap writes, not what it reads: the walk still
      // pages to the end to earn the token, but history older than the
      // caller's backfill window is skipped instead of upserted. Incremental
      // runs pass null — a change is worth applying whenever it happened.
      ingestFrom: syncToken
        ? null
        : new Date(Date.now() - backfillDays * 24 * 60 * 60 * 1000),
      // Whichever runs out first: this connection's own slice, or what's left
      // of the whole invocation's budget.
      deadline: Math.min(Date.now() + SYNC_TIME_BUDGET_MS, overallDeadline),
      onBatch: async (items) => {
        stats.batches += 1;
        const result = await processCalendarBatch({
          actor: actor.actor,
          workspaceId: actor.workspaceId,
          connectionId: connection.id,
          calendarId: connection.calendarId,
          items,
          peopleByEmail,
        });
        stats.createdPlans += result.createdPlans;
        stats.updatedPlans += result.updatedPlans;
        stats.cancelled += result.cancelled;
        stats.fetched += result.fetched;
      },
    });
    stats.incremental = listed.usedSyncToken;
    stats.bootstrapping = Boolean(listed.pendingPageToken);

    // Once a token is in hand the bootstrap is over, so the cursor is cleared.
    // While the walk is still in flight we keep the cursor and must NOT record
    // a token we do not have — writing one would strand the unwalked remainder.
    const nextToken =
      listed.nextSyncToken ?? (listed.pendingPageToken ? null : syncToken);
    await withCalendarDbRetry(() =>
      db.calendarConnection.update({
        where: { id: connection.id },
        data: {
          syncTokenEncrypted: encryptNullable(nextToken),
          fullSyncPageToken: listed.nextSyncToken
            ? null
            : (listed.pendingPageToken ?? null),
          lastSyncedAt: new Date(),
          lastError: null,
        },
      }),
    );
    await syncCalendarConnectionMirror(connection.id);

    await auditAction({
      actor: actor.actor,
      action: "calendar.sync",
      targetType: "calendarConnection",
      targetId: connection.id,
      metadata: { provider: "google", ...stats },
    });

    return stats;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google Calendar sync failed";
    await db.calendarConnection.update({
      where: { id: connection.id },
      data: { lastError: message },
    });
    await syncCalendarConnectionMirror(connection.id);
    return { ...stats, error: message };
  }
}

async function processCalendarBatch(input: {
  actor: DomainActor;
  workspaceId: string;
  connectionId: string;
  calendarId: string;
  items: GoogleCalendarEvent[];
  peopleByEmail: Map<string, { id: string; first: string; last: string }>;
}) {
  let createdPlans = 0;
  let updatedPlans = 0;
  let cancelled = 0;
  let fetched = 0;

  const toUpsert: GoogleCalendarEvent[] = [];
  for (const item of input.items) {
    if (!item.id) continue;
    fetched += 1;
    if (item.status === "cancelled") {
      cancelled += await withCalendarDbRetry(() =>
        markCancelled(
          input.connectionId,
          input.workspaceId,
          input.calendarId,
          item.id,
        ),
      );
      continue;
    }
    toUpsert.push(item);
  }

  // Each upsert is several sequential round-trips to a remote (Turso) DB, so
  // processing a batch one event at a time is latency-bound and can blow past the
  // function timeout on a busy calendar. Overlap a few events, not the whole
  // batch — 25 concurrent interactive transactions is what starved Qin and
  // Sightmachine after the personal calendars finished.
  const results = await mapPool(toUpsert, UPSERT_CONCURRENCY, (item) =>
    withCalendarDbRetry(() =>
      upsertCalendarEvent({
        actor: input.actor,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        calendarId: input.calendarId,
        item,
        peopleByEmail: input.peopleByEmail,
      }),
    ),
  );
  for (const result of results) {
    if (result.createdPlan) createdPlans += 1;
    else updatedPlans += 1;
  }

  return { createdPlans, updatedPlans, cancelled, fetched };
}

async function upsertCalendarEvent(input: {
  actor: DomainActor;
  workspaceId: string;
  connectionId: string;
  calendarId: string;
  item: GoogleCalendarEvent;
  peopleByEmail: Map<string, { id: string; first: string; last: string }>;
}) {
  const start = parseGoogleDate(input.item.start);
  if (!start) return { createdPlan: false };
  const end = parseGoogleDate(input.item.end);
  const metadata = googleEventMetadata(input.item, input.calendarId);
  const link = await db.calendarEventLink.findUnique({
    where: {
      workspaceId_provider_calendarId_externalEventId: {
        workspaceId: input.workspaceId,
        provider: "google",
        calendarId: input.calendarId,
        externalEventId: input.item.id,
      },
    },
    include: {
      plan: {
        include: { fulfilledBy: { select: { id: true } } },
      },
    },
  });

  const externalInstanceId = `${SOURCE}:${input.calendarId}:${input.item.id}`;
  const title = input.item.summary?.trim() || "Untitled Google Calendar event";
  const matchingPlan = await findSharedOccurrencePlan({
    workspaceId: input.workspaceId,
    calendarId: input.calendarId,
    iCalUID: input.item.iCalUID,
    title,
    start,
  });
  const currentPlan = link?.plan ?? null;
  const shouldAdoptMatchingPlan = Boolean(
    matchingPlan &&
    matchingPlan.id !== currentPlan?.id &&
    (!currentPlan ||
      (!currentPlan.fulfilledBy &&
        (Boolean(matchingPlan.fulfilledBy) ||
          matchingPlan.createdAt < currentPlan.createdAt))),
  );
  const sharedPlan = shouldAdoptMatchingPlan ? matchingPlan : null;
  const replacedPlanId =
    sharedPlan && currentPlan?.id !== sharedPlan.id
      ? (currentPlan?.id ?? null)
      : null;
  const linkedEventId = link?.eventId ?? sharedPlan?.fulfilledBy?.id ?? null;
  let planId = sharedPlan?.id ?? link?.planId ?? null;
  let createdPlan = false;
  if (planId) {
    await db.plan.update({
      where: { id: planId },
      data: {
        text: title,
        scheduledStart: start,
        scheduledEnd: end ?? null,
        successSignals: JSON.stringify(metadata),
      },
    });
  } else {
    const existingPlan = await db.plan.findUnique({
      where: { externalInstanceId },
      select: { id: true },
    });
    const plan =
      existingPlan ??
      (await db.plan.create({
        data: {
          workspaceId: input.workspaceId,
          text: title,
          scheduledStart: start,
          scheduledEnd: end ?? null,
          externalSource: SOURCE,
          externalInstanceId,
          reconciliationStatus: linkedEventId ? "happened" : "pending",
          reconciledAt: linkedEventId ? new Date() : null,
          status: linkedEventId ? "completed" : "active",
          successSignals: JSON.stringify(metadata),
        },
        select: { id: true },
      }));
    planId = plan.id;
    createdPlan = !existingPlan;
    if (createdPlan) {
      await auditAction({
        actor: input.actor,
        action: "plan.create",
        targetType: "plan",
        targetId: plan.id,
        metadata: { source: SOURCE, externalEventId: input.item.id },
      });
    }
  }

  // Compatibility bridge: old syncs wrote provider occurrences directly as
  // Events. Preserve those records and link the new prediction to them rather
  // than presenting the occurrence for review or creating a duplicate Event.
  if (link?.eventId) {
    await db.event.updateMany({
      where: {
        id: link.eventId,
        workspaceId: input.workspaceId,
        sourcePlanId: null,
      },
      data: { sourcePlanId: planId },
    });
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
    update: {
      planId,
      eventId: sharedPlan?.fulfilledBy?.id ?? undefined,
      iCalUID: input.item.iCalUID ?? null,
      status: input.item.status ?? "confirmed",
      lastSeenAt: new Date(),
    },
    create: {
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      provider: "google",
      calendarId: input.calendarId,
      externalEventId: input.item.id,
      iCalUID: input.item.iCalUID ?? null,
      planId,
      eventId: sharedPlan?.fulfilledBy?.id ?? null,
      status: input.item.status ?? "confirmed",
      lastSeenAt: new Date(),
    },
  });

  if (replacedPlanId && !currentPlan?.fulfilledBy) {
    const remainingLinks = await db.calendarEventLink.count({
      where: { planId: replacedPlanId },
    });
    if (remainingLinks === 0) {
      await db.$transaction(
        [
          db.plan.update({
            where: { id: replacedPlanId },
            data: {
              status: "abandoned",
              reconciliationStatus: "merged_duplicate",
              reconciledAt: new Date(),
            },
          }),
          db.reviewItem.updateMany({
            where: {
              workspaceId: input.workspaceId,
              source: "calendar_reconciliation",
              sourceId: replacedPlanId,
              status: "pending",
            },
            data: { status: "dismissed", resolvedAt: new Date() },
          }),
        ],
        CALENDAR_TX,
      );
    }
  }

  // Only ask once the day has passed. Creating a review item at sync time asked
  // "did this happen?" about events that had not happened yet, which is most of
  // how the queue reached 59 pending. Anything still unresolved is picked up by
  // matchCalendarOutcomes, which resolves it from evidence or retires it.
  const dayHasPassed = start.getTime() < Date.now() - 24 * 60 * 60 * 1000;
  const confidence = reconciliationConfidence(input.item, planId);
  if (!linkedEventId && dayHasPassed) {
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
        title,
        scheduledStart: start.toISOString(),
        scheduledEnd: end?.toISOString() ?? null,
        externalEventId: input.item.id,
        calendarId: input.calendarId,
      },
      // Tier follows the evidence instead of being hardcoded to "review". Every
      // item used to be review tier with a null confidence, which blocked bulk
      // action (bulk dismiss refuses review/confirm by design) and left the
      // existing "auto-approve high-confidence matches" rule with nothing to act
      // on. An invitation you accepted is genuinely safe to clear in bulk; a solo
      // hold with no corroboration still deserves a look.
      riskTier: confidence >= 0.9 ? "safe_auto" : "review",
      priority: confidence >= 0.9 ? 4 : 2,
      confidence,
    });
  }

  const matchedPeople = matchedAttendees(input.item, input.peopleByEmail);
  const declinedPeople = declinedMatchedAttendees(
    input.item,
    input.peopleByEmail,
  );
  const activeSourceCount = await db.calendarEventLink.count({
    where: { planId, status: { not: "cancelled" } },
  });
  if (activeSourceCount > 1) {
    if (matchedPeople.length) {
      await db.$transaction(
        matchedPeople.map((person) =>
          db.planExpectedPerson.upsert({
            where: {
              planId_personId: { planId: planId!, personId: person.id },
            },
            update: { workspaceId: input.workspaceId },
            create: {
              planId: planId!,
              personId: person.id,
              workspaceId: input.workspaceId,
            },
          }),
        ),
        CALENDAR_TX,
      );
    }
  } else {
    await db.$transaction(
      [
        db.planExpectedPerson.deleteMany({ where: { planId } }),
        ...(matchedPeople.length
          ? [
              db.planExpectedPerson.createMany({
                data: matchedPeople.map((person) => ({
                  planId: planId!,
                  personId: person.id,
                  workspaceId: input.workspaceId,
                })),
              }),
            ]
          : []),
      ],
      CALENDAR_TX,
    );
  }
  await pruneDeclinedAttendeeInteractions({
    workspaceId: input.workspaceId,
    planId,
    eventId: linkedEventId,
    // A decline on one copied calendar cannot prove non-attendance when
    // another source for the shared occurrence may still say accepted.
    declinedPersonIds:
      activeSourceCount > 1 ? [] : declinedPeople.map((person) => person.id),
  });

  return { createdPlan };
}

async function findSharedOccurrencePlan(input: {
  workspaceId: string;
  calendarId: string;
  iCalUID?: string;
  title: string;
  start: Date;
}) {
  if (input.iCalUID) {
    const exactCopies = await db.calendarEventLink.findMany({
      where: {
        workspaceId: input.workspaceId,
        provider: "google",
        iCalUID: input.iCalUID,
        calendarId: { not: input.calendarId },
        status: { not: "cancelled" },
        planId: { not: null },
      },
      select: {
        plan: {
          select: {
            id: true,
            createdAt: true,
            scheduledStart: true,
            fulfilledBy: { select: { id: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    const exact = exactCopies.find(
      (copy) =>
        copy.plan?.scheduledStart &&
        Math.abs(copy.plan.scheduledStart.getTime() - input.start.getTime()) <=
          DUPLICATE_OCCURRENCE_WINDOW_MS,
    );
    if (exact?.plan) return exact.plan;
  }

  const candidates = await db.plan.findMany({
    where: {
      workspaceId: input.workspaceId,
      externalSource: SOURCE,
      scheduledStart: {
        gte: new Date(input.start.getTime() - DUPLICATE_OCCURRENCE_WINDOW_MS),
        lte: new Date(input.start.getTime() + DUPLICATE_OCCURRENCE_WINDOW_MS),
      },
      calendarLinks: {
        some: {
          provider: "google",
          calendarId: { not: input.calendarId },
          status: { not: "cancelled" },
        },
      },
    },
    select: {
      id: true,
      createdAt: true,
      text: true,
      scheduledStart: true,
      fulfilledBy: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return (
    candidates.find(
      (candidate) =>
        candidate.scheduledStart &&
        sameCalendarOccurrence(
          { name: candidate.text, start: candidate.scheduledStart },
          { name: input.title, start: input.start },
        ),
    ) ?? null
  );
}

async function peopleEmailIndex(workspaceId: string) {
  const byEmail = new Map<
    string,
    { id: string; first: string; last: string }
  >();
  let cursor: string | undefined;
  do {
    const rows = await db.person.findMany({
      where: { workspaceId },
      select: { id: true, first: true, last: true, emails: true },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      for (const email of parseJsonList(row.emails))
        byEmail.set(email.toLowerCase(), row);
    }
    cursor = rows.length === 500 ? rows.at(-1)?.id : undefined;
  } while (cursor);
  return byEmail;
}

function peopleFromEmails(
  emails: Iterable<string>,
  peopleByEmail: Map<string, { id: string; first: string; last: string }>,
) {
  const seen = new Set<string>();
  const people: { id: string; first: string; last: string }[] = [];
  for (const email of emails) {
    const person = peopleByEmail.get(email);
    if (!person || seen.has(person.id)) continue;
    seen.add(person.id);
    people.push(person);
  }
  return people;
}

function matchedAttendees(
  item: GoogleCalendarEvent,
  peopleByEmail: Map<string, { id: string; first: string; last: string }>,
) {
  return peopleFromEmails(participatingAttendeeEmails(item), peopleByEmail);
}

function declinedMatchedAttendees(
  item: GoogleCalendarEvent,
  peopleByEmail: Map<string, { id: string; first: string; last: string }>,
) {
  return peopleFromEmails(
    declinedAttendeeEmails(item.attendees),
    peopleByEmail,
  );
}

async function pruneDeclinedAttendeeInteractions(input: {
  workspaceId: string;
  planId: string;
  eventId: string | null;
  declinedPersonIds: string[];
}) {
  if (!input.declinedPersonIds.length) return;
  let eventId = input.eventId;
  if (!eventId) {
    const plan = await db.plan.findUnique({
      where: { id: input.planId },
      select: { fulfilledBy: { select: { id: true } } },
    });
    eventId = plan?.fulfilledBy?.id ?? null;
  }
  if (!eventId) return;
  await db.interaction.deleteMany({
    where: {
      workspaceId: input.workspaceId,
      eventId,
      personId: { in: input.declinedPersonIds },
      type: { in: ["calendar", "meeting"] },
      emotionalWeight: null,
      outcome: null,
      notes: null,
      OR: [
        { source: "granola" },
        { source: "google-calendar" },
        { source: null, type: "calendar" },
      ],
    },
  });
}

async function markCancelled(
  connectionId: string,
  workspaceId: string,
  calendarId: string,
  externalEventId: string,
) {
  const link = await db.calendarEventLink.findUnique({
    where: {
      workspaceId_provider_calendarId_externalEventId: {
        workspaceId,
        provider: "google",
        calendarId,
        externalEventId,
      },
    },
    select: {
      id: true,
      planId: true,
      plan: { select: { fulfilledBy: { select: { id: true } } } },
    },
  });
  if (!link) return 0;
  await db.calendarEventLink.update({
    where: { id: link.id },
    data: { connectionId, status: "cancelled", lastSeenAt: new Date() },
  });
  if (link.planId && !link.plan?.fulfilledBy) {
    const remainingSources = await db.calendarEventLink.count({
      where: { planId: link.planId, status: { not: "cancelled" } },
    });
    if (remainingSources === 0) {
      await db.plan.update({
        where: { id: link.planId },
        data: {
          status: "abandoned",
          reconciliationStatus: "cancelled",
          reconciledAt: new Date(),
        },
      });
    }
  }
  return 1;
}

async function usableAccessToken(connection: {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
}) {
  if (
    connection.accessToken &&
    connection.expiresAt &&
    connection.expiresAt.getTime() > Date.now() + 60_000
  ) {
    return connection.accessToken;
  }
  if (!connection.refreshToken) {
    if (connection.accessToken) return connection.accessToken;
    throw badRequest("Google Calendar connection has no refresh token");
  }
  const token = await refreshAccessToken(connection.refreshToken);
  await db.calendarConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encryptNullable(token.access_token),
      expiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : null,
      refreshTokenEncrypted: encryptNullable(
        token.refresh_token ?? connection.refreshToken,
      ),
      scope: token.scope ?? undefined,
    },
  });
  await syncCalendarConnectionMirror(connection.id);
  return token.access_token;
}

async function syncCalendarConnectionMirrors(workspaceId: string) {
  const connections = await db.calendarConnection.findMany({
    where: { workspaceId, provider: "google" },
    select: { id: true },
  });
  for (const connection of connections) {
    await syncCalendarConnectionMirror(connection.id);
  }
}

async function syncCalendarConnectionMirror(connectionId: string) {
  const connection = await db.calendarConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      workspaceId: true,
      userId: true,
      provider: true,
      status: true,
      accountEmail: true,
      calendarId: true,
      calendarSummary: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      expiresAt: true,
      scope: true,
      lastSyncedAt: true,
      lastError: true,
    },
  });
  if (!connection) return;

  const data = {
    workspaceId: connection.workspaceId,
    userId: connection.userId,
    kind: "calendar",
    provider: connection.provider,
    status: connection.status,
    accountEmail: connection.accountEmail,
    label: connection.calendarSummary,
    accessTokenEncrypted: connection.accessTokenEncrypted,
    refreshTokenEncrypted: connection.refreshTokenEncrypted,
    expiresAt: connection.expiresAt,
    scope: connection.scope,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
    metadata: JSON.stringify({
      calendarId: connection.calendarId,
      calendarSummary: connection.calendarSummary,
    }),
    sourceTable: "CalendarConnection",
    sourceId: connection.id,
  };
  const mirror = await db.connection.findFirst({
    where: {
      workspaceId: connection.workspaceId,
      sourceTable: "CalendarConnection",
      sourceId: connection.id,
    },
    select: { id: true },
  });
  if (mirror) {
    await db.connection.update({ where: { id: mirror.id }, data });
  } else {
    await db.connection.create({ data });
  }
}

// Thin wrapper over walkEventPages (google-calendar-sync.ts), which holds the
// paging state machine so it can be tested without server imports. All this
// adds is the Google URL and auth.
async function syncEventPages(
  accessToken: string,
  input: {
    calendarId: string;
    syncToken: string | null;
    resumePageToken: string | null;
    ingestFrom: Date | null;
    deadline: number;
    onBatch: (items: GoogleCalendarEvent[]) => Promise<void>;
  },
) {
  return walkEventPages<GoogleCalendarEvent>({
    syncToken: input.syncToken,
    resumePageToken: input.resumePageToken,
    ingestFrom: input.ingestFrom,
    deadline: input.deadline,
    pageSize: GOOGLE_PAGE_SIZE,
    batchSize: DB_BATCH_SIZE,
    onBatch: input.onBatch,
    fetchPage: async (params) => {
      const res = await googleFetch(
        `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?${params}`,
        accessToken,
      );
      if (!res.ok) return { status: res.status, ok: false };
      return {
        status: res.status,
        ok: true,
        page: (await res.json()) as EventsListResponse,
      };
    },
  });
}

async function exchangeCode(code: string, redirectUri: string) {
  const clientId = calendarClientId();
  const clientSecret = calendarClientSecret();
  if (!clientId || !clientSecret)
    throw badRequest("Google Calendar OAuth is not configured");
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
    signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[google-calendar] token exchange failed", {
      status: res.status,
      body,
      redirectUri,
    });
    throw new Error(`Google token exchange failed (${res.status}): ${body}`);
  }
  return (await res.json()) as TokenResponse;
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = calendarClientId();
  const clientSecret = calendarClientSecret();
  if (!clientId || !clientSecret)
    throw badRequest("Google Calendar OAuth is not configured");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`);
  return (await res.json()) as TokenResponse;
}

async function fetchPrimaryCalendar(accessToken: string) {
  const res = await googleFetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/primary`,
    accessToken,
  );
  if (!res.ok) return {};
  return (await res.json()) as { summary?: string };
}

async function fetchCalendarList(accessToken: string) {
  const calendars: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      maxResults: "250",
      showDeleted: "false",
      showHidden: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await googleFetch(
      `${GOOGLE_CALENDAR_BASE}/users/me/calendarList?${params}`,
      accessToken,
    );
    if (!res.ok) throw new Error(`Google Calendar list failed (${res.status})`);
    const data = (await res.json()) as CalendarListResponse;
    calendars.push(
      ...(data.items ?? []).filter((calendar) => !calendar.deleted),
    );
    pageToken = data.nextPageToken;
  } while (pageToken);

  return calendars.sort((a, b) => {
    if (a.primary) return -1;
    if (b.primary) return 1;
    return (a.summary ?? a.id).localeCompare(b.summary ?? b.id);
  });
}

function normalizedCalendarId(calendar: GoogleCalendarListEntry) {
  return calendar.primary ? "primary" : calendar.id;
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
  };
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
  });
}

function decryptedCredential(connection: {
  id: string;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
}) {
  return {
    id: connection.id,
    accessToken: decryptNullable(connection.accessTokenEncrypted),
    refreshToken: decryptNullable(connection.refreshTokenEncrypted),
    expiresAt: connection.expiresAt,
  };
}

async function fetchGoogleAccountEmail(accessToken: string) {
  const res = await googleFetch(GOOGLE_USERINFO_URL, accessToken);
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ?? null;
}

function googleFetch(url: string, accessToken: string) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
  });
}

function googleCalendarRedirectUri(origin: string | null) {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  if (explicit) return explicit;
  const base =
    process.env.HOME_URL?.trim() ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    vercelProductionUrl() ||
    origin;
  if (!base)
    throw badRequest("Google Calendar redirect URI could not be resolved");
  return `${base.replace(/\/$/, "")}/admin/connections/google/calendar/callback`;
}

function signState(state: OAuthState) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifyState(value: string) {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) throw badRequest("Invalid Google Calendar state");
  const expected = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  if (signature !== expected)
    throw forbidden("Invalid Google Calendar state signature");
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as OAuthState;
}

function stateSecret() {
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "dev-calendar-state-secret"
  );
}

function calendarClientId() {
  return (
    process.env.GOOGLE_CALENDAR_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    null
  );
}

function calendarClientSecret() {
  return (
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    null
  );
}

function calendarAccountEmail() {
  return (process.env.GOOGLE_CALENDAR_ACCOUNT_EMAIL || "jdf247@gmail.com")
    .trim()
    .toLowerCase();
}

function assertExpectedCalendarAccount(accountEmail: string | null) {
  const expected = calendarAccountEmail();
  if (!expected) return;
  const actual = accountEmail?.trim().toLowerCase() ?? null;
  if (actual !== expected) {
    throw badRequest(
      `Connect ${expected} to Calendar, not ${actual ?? "an unknown Google account"}.`,
      {
        expectedAccountEmail: expected,
        accountEmail: actual,
      },
    );
  }
}

function vercelProductionUrl() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : null;
}

function parseGoogleDate(
  value: GoogleCalendarEvent["start"] | GoogleCalendarEvent["end"],
) {
  const raw = value?.dateTime ?? value?.date;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
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
    attendees: (item.attendees ?? []).map((attendee) => ({
      email: attendee.email ?? null,
      displayName: attendee.displayName ?? null,
      responseStatus: attendee.responseStatus ?? null,
      self: Boolean(attendee.self),
    })),
    organizer: item.organizer ?? null,
    creator: item.creator ?? null,
  };
}

function sourceMarker(calendarId: string, eventId: string) {
  return `${SOURCE}:${calendarId}:${eventId}`;
}

function parseJsonList(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseCalendarMetadata(
  value: string | null | undefined,
): CalendarEventMetadata {
  const parsed = parseJsonObject(value ?? null) as CalendarEventMetadata | null;
  return parsed ?? {};
}

function normalizeBackfillDays(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_BACKFILL_DAYS;
  const days = Math.round(value);
  if (days < 1) return DEFAULT_BACKFILL_DAYS;
  return Math.min(days, MAX_BACKFILL_DAYS);
}

function normalizeTraceLimit(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50;
  const limit = Math.round(value);
  if (limit < 1) return 50;
  return Math.min(limit, 150);
}

function personName(person: { first: string; last: string }) {
  return (
    [person.first, person.last].filter(Boolean).join(" ").trim() ||
    "Unnamed person"
  );
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}
