import { createHmac, randomBytes } from "crypto";
import { normalizeEmailForMatch, workspaceEmailIndex } from "@life-os/domain";
import type { GmailConnection, Prisma } from "@life-os/db";
import { decryptNullable, encryptNullable } from "@life-os/db/crypto";
import { db } from "@/lib/db";
import { contactIdentifiers, type ParsedContact } from "@/lib/vcard";
import { badRequest, forbidden, notFound } from "@/server/api/errors";
import { auditAction, type DomainActor } from "./audit";
import type { AccessActor } from "./access";
import { stageRecord } from "./inbox";
import { appendDailySourceInteraction } from "./interactions";
import { sourceMarkers } from "./idempotency";
import {
  googleFetch,
  requestGoogleToken,
  type GoogleTokenResponse,
} from "@/server/integrations/google/client";
import {
  parseGmailMessage as parseMessage,
  type EmailParty,
  type GmailMessage,
  type ParsedMessage,
} from "@/server/integrations/google/gmail-message-parser";
import {
  decodeStoredJson,
  gmailMessageMetadataContract,
  storedStringList,
} from "@life-os/contracts";
import { startWorkflowRun, syncHealth } from "@/server/observability/workflow";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";
const GOOGLE_PEOPLE_BASE = "https://people.googleapis.com/v1";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_CONTACTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/contacts.readonly";
// Google's auto-saved "other contacts". Additive: connections granted before
// this scope existed keep working, and simply gain the extra source on reconnect.
const GOOGLE_OTHER_CONTACTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/contacts.other.readonly";
const GMAIL_SCOPE = `${GMAIL_READONLY_SCOPE} ${GOOGLE_CONTACTS_READONLY_SCOPE} ${GOOGLE_OTHER_CONTACTS_READONLY_SCOPE}`;
const SOURCE = "gmail";
const DEFAULT_BACKFILL_DAYS = 30;
// Stop fetching new messages after this long and report the run as
// incomplete — Vercel kills the function at maxDuration and an unbounded
// backfill can't finish in one invocation. Progress persists per message
// (already-imported messages are skipped on the next run), so repeated runs
// converge until one completes and incremental history sync takes over.
const SYNC_BUDGET_MS = 240_000;
const MAX_BACKFILL_DAYS = 3650;
const ALL_TIME_BACKFILL_DAYS = 36500;
const GMAIL_PAGE_SIZE = 100;
const DB_BATCH_SIZE = 25;

type OAuthState = {
  workspaceId: string;
  userId: string;
  nonce: string;
  returnTo: string;
};

type TokenResponse = GoogleTokenResponse;

type GmailProfile = {
  emailAddress?: string;
  historyId?: string;
};

type GooglePeopleResponse = {
  connections?: GooglePerson[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

type GoogleOtherContactsResponse = {
  otherContacts?: GooglePerson[];
  nextPageToken?: string;
};

type GoogleContactGroupsResponse = {
  contactGroups?: {
    resourceName?: string;
    name?: string;
    formattedName?: string;
  }[];
  nextPageToken?: string;
};

type GoogleFieldMetadata = { primary?: boolean };

type GooglePerson = {
  resourceName?: string;
  etag?: string;
  names?: { displayName?: string; givenName?: string; familyName?: string }[];
  emailAddresses?: { value?: string; metadata?: GoogleFieldMetadata }[];
  phoneNumbers?: { value?: string; metadata?: GoogleFieldMetadata }[];
  organizations?: { name?: string; title?: string }[];
  birthdays?: { date?: GoogleBirthdayDate }[];
  addresses?: {
    formattedValue?: string;
    city?: string;
    region?: string;
    country?: string;
  }[];
  urls?: { value?: string }[];
  biographies?: { value?: string }[];
  memberships?: {
    contactGroupMembership?: { contactGroupResourceName?: string };
  }[];
};

type GoogleBirthdayDate = { year?: number; month?: number; day?: number };

type GmailListResponse = {
  messages?: { id: string; threadId?: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailHistoryResponse = {
  history?: {
    id?: string;
    messagesAdded?: { message?: { id?: string; threadId?: string } }[];
    messagesDeleted?: { message?: { id?: string; threadId?: string } }[];
  }[];
  nextPageToken?: string;
  historyId?: string;
};

type GmailMessageMetadata = {
  subject?: string | null;
  from?: EmailParty[];
  to?: EmailParty[];
  cc?: EmailParty[];
  bcc?: EmailParty[];
  snippet?: string | null;
  threadId?: string | null;
  historyId?: string | null;
};

type SyncOptions = {
  backfillDays?: number | null;
  unmatchedMode?: "skip" | "stage" | null;
  // Only stage unmatched messages Gmail marks IMPORTANT (default on).
  // Superhuman's Important/Other triage reads and writes this same signal,
  // so the inbox inherits its sorting — including manual moves.
  importantOnly?: boolean | null;
};

type SyncStats = {
  createdInteractions: number;
  updatedInteractions: number;
  staged: number;
  skipped: number;
  deleted: number;
  fetched: number;
  batches: number;
  backfillDays: number;
  incremental: boolean;
  unmatchedMode: "skip" | "stage";
  importantOnly: boolean;
  incomplete: boolean;
};

async function mirrorGmailConnection(
  tx: Prisma.TransactionClient,
  connection: GmailConnection,
) {
  const existing = await tx.connection.findFirst({
    where: {
      workspaceId: connection.workspaceId,
      sourceTable: "GmailConnection",
      sourceId: connection.id,
    },
    select: { id: true },
  });
  const data = {
    userId: connection.userId,
    kind: "gmail",
    provider: connection.provider,
    status: connection.status,
    accountEmail: connection.accountEmail,
    accessTokenEncrypted: connection.accessTokenEncrypted,
    refreshTokenEncrypted: connection.refreshTokenEncrypted,
    expiresAt: connection.expiresAt,
    scope: connection.scope,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
    metadata: JSON.stringify({
      mailboxId: connection.mailboxId,
      historyId: connection.historyId,
    }),
    sourceTable: "GmailConnection",
    sourceId: connection.id,
  };

  if (existing) {
    await tx.connection.update({ where: { id: existing.id }, data });
  } else {
    await tx.connection.create({
      data: { workspaceId: connection.workspaceId, ...data },
    });
  }
}

export function gmailConfigured() {
  return Boolean(gmailClientId() && gmailClientSecret());
}

export async function gmailStatus(actor: AccessActor) {
  const connection = await db.gmailConnection.findFirst({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      accountEmail: true,
      mailboxId: true,
      scope: true,
      historyId: true,
      lastSyncedAt: true,
      lastError: true,
      updatedAt: true,
      _count: { select: { messageLinks: true } },
    },
  });

  return {
    configured: gmailConfigured(),
    redirectUri: gmailRedirectUri(null),
    connection: connection
      ? {
          ...connection,
          messageCount: connection._count.messageLinks,
          syncHealth: syncHealth(connection.lastSyncedAt, connection.lastError),
          _count: undefined,
        }
      : null,
  };
}

export async function gmailTrace(
  actor: AccessActor,
  options: { limit?: number } = {},
) {
  const limit = normalizeTraceLimit(options.limit);
  const connection = await db.gmailConnection.findFirst({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, mailboxId: true, accountEmail: true },
  });

  const runs = await db.auditLog.findMany({
    where: { workspaceId: actor.workspaceId, action: "gmail.sync" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, actorLabel: true, metadata: true },
  });

  const links = connection
    ? await db.gmailMessageLink.findMany({
        where: {
          workspaceId: actor.workspaceId,
          provider: "google",
          connectionId: connection.id,
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: limit,
        include: {
          interaction: {
            select: {
              id: true,
              createdAt: true,
              timestamp: true,
              summary: true,
              notes: true,
              direction: true,
              person: {
                select: { id: true, first: true, last: true, emails: true },
              },
            },
          },
          stagedItem: {
            select: {
              id: true,
              createdAt: true,
              updatedAt: true,
              status: true,
              contactName: true,
              contactEmail: true,
              summary: true,
              direction: true,
              timestamp: true,
              metadata: true,
              candidatePerson: {
                select: { id: true, first: true, last: true, emails: true },
              },
            },
          },
        },
      })
    : [];

  const recentInteractions = await db.interaction.findMany({
    where: {
      workspaceId: actor.workspaceId,
      type: "email",
      notes: { contains: `${SOURCE}:`, mode: "insensitive" as const },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      createdAt: true,
      timestamp: true,
      summary: true,
      notes: true,
      direction: true,
      person: { select: { id: true, first: true, last: true, emails: true } },
    },
  });
  const interactionsByMessage = new Map<string, typeof recentInteractions>();
  for (const interaction of recentInteractions) {
    for (const marker of sourceMarkers(interaction.notes)) {
      if (!marker.startsWith(`${SOURCE}:`)) continue;
      const messageId = marker.slice(`${SOURCE}:`.length);
      interactionsByMessage.set(messageId, [
        ...(interactionsByMessage.get(messageId) ?? []),
        interaction,
      ]);
    }
  }

  return {
    connection,
    runs: runs.map((run) => ({
      id: run.id,
      createdAt: run.createdAt,
      actorLabel: run.actorLabel,
      metadata: parseJsonObject(run.metadata),
    })),
    messages: links.map((link) => {
      const stagedMetadata = parseGmailMetadata(link.stagedItem?.metadata);
      const linkedInteractions = dedupeInteractions([
        ...(interactionsByMessage.get(link.externalMessageId) ?? []),
        ...(link.interaction ? [link.interaction] : []),
      ]).map((interaction) => ({
        id: interaction.id,
        createdAt: interaction.createdAt,
        timestamp: interaction.timestamp,
        summary: interaction.summary,
        direction: interaction.direction,
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
        mailboxId: link.mailboxId,
        externalMessageId: link.externalMessageId,
        threadId: link.threadId,
        historyId: link.historyId,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
        lastSeenAt: link.lastSeenAt,
        subject:
          stagedMetadata.subject ??
          link.stagedItem?.summary ??
          link.interaction?.summary ??
          null,
        snippet: stagedMetadata.snippet ?? null,
        from: stagedMetadata.from ?? [],
        to: stagedMetadata.to ?? [],
        linkedPeople: linkedInteractions,
        stagedItem: link.stagedItem
          ? {
              id: link.stagedItem.id,
              status: link.stagedItem.status,
              createdAt: link.stagedItem.createdAt,
              updatedAt: link.stagedItem.updatedAt,
              timestamp: link.stagedItem.timestamp,
              contactName: link.stagedItem.contactName,
              contactEmail: link.stagedItem.contactEmail,
              summary: link.stagedItem.summary,
              direction: link.stagedItem.direction,
              candidatePerson: link.stagedItem.candidatePerson
                ? {
                    id: link.stagedItem.candidatePerson.id,
                    name: personName(link.stagedItem.candidatePerson),
                    emails: parseJsonList(
                      link.stagedItem.candidatePerson.emails,
                    ),
                  }
                : null,
            }
          : null,
      };
    }),
  };
}

export async function importGmailContactsPreview(actor: AccessActor) {
  const connection = await db.gmailConnection.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      provider: "google",
      status: "active",
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!connection) throw notFound("Gmail is not connected");
  if (!hasGoogleContactsScope(connection.scope)) {
    throw badRequest("Reconnect Gmail to allow importing Google contacts", {
      reconnectRequired: true,
      missingScope: GOOGLE_CONTACTS_READONLY_SCOPE,
      reconnectUrl: `${homeConnectionsUrl()}/google/gmail/connect`,
    });
  }

  const accessToken = await usableAccessToken({
    id: connection.id,
    accessToken: decryptNullable(connection.accessTokenEncrypted),
    refreshToken: decryptNullable(connection.refreshTokenEncrypted),
    expiresAt: connection.expiresAt,
  });
  const contacts = await fetchGoogleContacts(accessToken, connection.scope);
  return {
    contacts,
    count: contacts.length,
    method: "google-contacts",
    accountEmail: connection.accountEmail,
  };
}

export function gmailAuthUrl(
  actor: AccessActor,
  origin: string,
  returnTo = "/admin",
) {
  const clientId = gmailClientId();
  if (!clientId || !gmailClientSecret())
    throw badRequest("Gmail OAuth is not configured");
  const redirectUri = gmailRedirectUri(origin);
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
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function handleGmailCallback(input: {
  code: string;
  state: string;
  origin: string;
}) {
  const state = verifyState(input.state);
  const token = await exchangeCode(input.code, gmailRedirectUri(input.origin));
  if (!token.refresh_token) {
    throw badRequest(
      "Google did not return a refresh token. Reconnect Gmail and approve offline access.",
    );
  }

  const profile = await fetchGmailProfile(token.access_token);
  const accountEmail = profile.emailAddress ?? null;
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;
  const mailboxId = "me";

  const connection = await db.$transaction(async (tx) => {
    const gmailConnection = await tx.gmailConnection.upsert({
      where: {
        workspaceId_provider_mailboxId: {
          workspaceId: state.workspaceId,
          provider: "google",
          mailboxId,
        },
      },
      update: {
        userId: state.userId,
        status: "active",
        accountEmail,
        accessTokenEncrypted: encryptNullable(token.access_token),
        refreshTokenEncrypted: encryptNullable(token.refresh_token),
        expiresAt,
        scope: token.scope ?? GMAIL_SCOPE,
        lastError: null,
      },
      create: {
        workspaceId: state.workspaceId,
        userId: state.userId,
        provider: "google",
        status: "active",
        accountEmail,
        mailboxId,
        accessTokenEncrypted: encryptNullable(token.access_token),
        refreshTokenEncrypted: encryptNullable(token.refresh_token),
        expiresAt,
        scope: token.scope ?? GMAIL_SCOPE,
      },
    });
    await mirrorGmailConnection(tx, gmailConnection);
    return gmailConnection;
  });

  await auditAction({
    actor: { type: "user", id: state.userId, workspaceId: state.workspaceId },
    action: "gmail.connect",
    targetType: "gmailConnection",
    targetId: connection.id,
    metadata: { provider: "google", accountEmail, mailboxId },
  });

  return { returnTo: state.returnTo, connectionId: connection.id };
}

export async function syncGmail(actor: AccessActor, options: SyncOptions = {}) {
  const connection = await db.gmailConnection.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      provider: "google",
      status: "active",
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!connection) throw notFound("Gmail is not connected");
  if (!connection.refreshTokenEncrypted && !connection.accessTokenEncrypted)
    throw badRequest("Gmail connection has no usable token");

  const accessToken = await usableAccessToken({
    id: connection.id,
    accessToken: decryptNullable(connection.accessTokenEncrypted),
    refreshToken: decryptNullable(connection.refreshTokenEncrypted),
    expiresAt: connection.expiresAt,
  });
  const backfillDays = normalizeBackfillDays(options.backfillDays);
  const unmatchedMode = options.unmatchedMode === "stage" ? "stage" : "skip";
  const importantOnly = options.importantOnly !== false;
  const deadline = Date.now() + SYNC_BUDGET_MS;
  const stats: SyncStats = {
    createdInteractions: 0,
    updatedInteractions: 0,
    staged: 0,
    skipped: 0,
    deleted: 0,
    fetched: 0,
    batches: 0,
    backfillDays,
    incremental: Boolean(connection.historyId),
    unmatchedMode,
    importantOnly,
    incomplete: false,
  };
  const telemetry = startWorkflowRun({
    workflow: "gmail.sync",
    workspaceId: actor.workspaceId,
    targetId: connection.id,
    context: { incremental: stats.incremental },
  });

  try {
    const peopleByEmail = await peopleEmailIndex(actor.workspaceId);

    const listed = connection.historyId
      ? await syncHistoryPages(accessToken, {
          connection,
          actor: actor.actor,
          peopleByEmail,
          stats,
          unmatchedMode,
          importantOnly,
          deadline,
        })
      : await syncMessagePages(accessToken, {
          connection,
          actor: actor.actor,
          peopleByEmail,
          stats,
          backfillDays,
          unmatchedMode,
          importantOnly,
          deadline,
        });

    stats.incomplete = Boolean(listed.incomplete);
    const profile = listed.incomplete
      ? null
      : await fetchGmailProfile(accessToken);
    await db.$transaction(async (tx) => {
      const updated = await tx.gmailConnection.update({
        where: { id: connection.id },
        data: {
          // Only advance the incremental checkpoint after a complete run —
          // otherwise unprocessed messages older than the checkpoint would be
          // skipped forever by history sync.
          historyId: listed.incomplete
            ? connection.historyId
            : (listed.historyId ?? profile?.historyId ?? connection.historyId),
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });
      await mirrorGmailConnection(tx, updated);
    });

    await auditAction({
      actor: actor.actor,
      action: "gmail.sync",
      targetType: "gmailConnection",
      targetId: connection.id,
      metadata: { provider: "google", ...stats },
    });

    telemetry.finish(stats.incomplete ? "partial" : "succeeded", stats);
    return { ...stats, runId: telemetry.runId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gmail sync failed";
    await db.$transaction(async (tx) => {
      const updated = await tx.gmailConnection.update({
        where: { id: connection.id },
        data: { lastError: message },
      });
      await mirrorGmailConnection(tx, updated);
    });
    telemetry.finish("failed", stats, error);
    throw error;
  }
}

async function syncMessagePages(
  accessToken: string,
  input: {
    connection: GmailConnectionShape;
    actor: DomainActor;
    peopleByEmail: Map<string, { id: string; first: string; last: string }>;
    stats: SyncStats;
    backfillDays: number;
    unmatchedMode: "skip" | "stage";
    importantOnly: boolean;
    deadline: number;
  },
) {
  let pageToken: string | undefined;
  let newestHistoryId: string | null = null;
  const after = Math.floor(
    (Date.now() - input.backfillDays * 24 * 60 * 60 * 1000) / 1000,
  );

  for (;;) {
    const params = new URLSearchParams({
      maxResults: String(GMAIL_PAGE_SIZE),
      q: `after:${after} -in:spam -in:trash`,
      includeSpamTrash: "false",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gmailFetch(
      `${GMAIL_BASE}/users/me/messages?${params}`,
      accessToken,
    );
    if (!res.ok)
      throw new Error(`Gmail messages request failed (${res.status})`);
    const data = (await res.json()) as GmailListResponse;
    const ids = (data.messages ?? [])
      .map((message) => message.id)
      .filter(Boolean);
    for (const batch of chunk(ids, DB_BATCH_SIZE)) {
      input.stats.batches += 1;
      const result = await processMessageBatch(accessToken, {
        ...input,
        messageIds: batch,
      });
      newestHistoryId = result.historyId ?? newestHistoryId;
      if (result.incomplete)
        return { historyId: newestHistoryId, incomplete: true };
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return { historyId: newestHistoryId, incomplete: false };
}

async function syncHistoryPages(
  accessToken: string,
  input: {
    connection: GmailConnectionShape;
    actor: DomainActor;
    peopleByEmail: Map<string, { id: string; first: string; last: string }>;
    stats: SyncStats;
    unmatchedMode: "skip" | "stage";
    importantOnly: boolean;
    deadline: number;
  },
) {
  let pageToken: string | undefined;
  let nextHistoryId: string | null = null;

  for (;;) {
    const params = new URLSearchParams({
      maxResults: String(GMAIL_PAGE_SIZE),
      startHistoryId: input.connection.historyId ?? "",
      historyTypes: "messageAdded",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gmailFetch(
      `${GMAIL_BASE}/users/me/history?${params}`,
      accessToken,
    );
    if (res.status === 404) {
      input.stats.incremental = false;
      return await syncMessagePages(accessToken, {
        ...input,
        backfillDays: DEFAULT_BACKFILL_DAYS,
      });
    }
    if (!res.ok)
      throw new Error(`Gmail history request failed (${res.status})`);
    const data = (await res.json()) as GmailHistoryResponse;
    const messageIds = new Set<string>();
    const deletedIds = new Set<string>();
    for (const history of data.history ?? []) {
      for (const added of history.messagesAdded ?? []) {
        if (added.message?.id) messageIds.add(added.message.id);
      }
      for (const deleted of history.messagesDeleted ?? []) {
        if (deleted.message?.id) deletedIds.add(deleted.message.id);
      }
    }
    for (const id of deletedIds) {
      input.stats.deleted += await markDeleted(input.connection, id);
    }
    for (const batch of chunk([...messageIds], DB_BATCH_SIZE)) {
      input.stats.batches += 1;
      const result = await processMessageBatch(accessToken, {
        ...input,
        messageIds: batch,
      });
      // Bail without advancing the checkpoint — the caller keeps the old
      // historyId so the next run re-covers this window (already-imported
      // messages are skipped cheaply).
      if (result.incomplete) return { historyId: null, incomplete: true };
    }
    nextHistoryId = data.historyId ?? nextHistoryId;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return { historyId: nextHistoryId, incomplete: false };
}

async function processMessageBatch(
  accessToken: string,
  input: {
    connection: GmailConnectionShape;
    actor: DomainActor;
    peopleByEmail: Map<string, { id: string; first: string; last: string }>;
    stats: SyncStats;
    messageIds: string[];
    unmatchedMode: "skip" | "stage";
    importantOnly: boolean;
    deadline: number;
  },
) {
  let newestHistoryId: string | null = null;

  // Skip messages already imported in a previous run without paying a Gmail
  // fetch for each — this is what makes interrupted backfills resumable.
  const existing = await db.gmailMessageLink.findMany({
    where: {
      workspaceId: input.connection.workspaceId,
      provider: "google",
      mailboxId: input.connection.mailboxId,
      externalMessageId: { in: input.messageIds },
    },
    select: { externalMessageId: true },
  });
  const alreadyImported = new Set(
    existing.map((link) => link.externalMessageId),
  );

  for (const messageId of input.messageIds) {
    if (alreadyImported.has(messageId)) {
      input.stats.skipped += 1;
      continue;
    }
    if (Date.now() > input.deadline) {
      return { historyId: newestHistoryId, incomplete: true };
    }
    const raw = await fetchMessage(accessToken, messageId);
    if (!raw) {
      input.stats.skipped += 1;
      continue;
    }
    newestHistoryId = raw.historyId ?? newestHistoryId;
    const message = parseMessage(raw, input.connection.accountEmail);
    input.stats.fetched += 1;
    const result = await importMessage({
      actor: input.actor,
      workspaceId: input.connection.workspaceId,
      connectionId: input.connection.id,
      mailboxId: input.connection.mailboxId,
      mailboxEmail: input.connection.accountEmail,
      peopleByEmail: input.peopleByEmail,
      message,
      unmatchedMode: input.unmatchedMode,
      importantOnly: input.importantOnly,
    });
    input.stats.createdInteractions += result.createdInteractions;
    input.stats.updatedInteractions += result.updatedInteractions;
    input.stats.staged += result.staged;
    input.stats.skipped += result.skipped;
  }
  return { historyId: newestHistoryId, incomplete: false };
}

async function importMessage(input: {
  actor: DomainActor;
  workspaceId: string;
  connectionId: string;
  mailboxId: string;
  mailboxEmail: string | null;
  peopleByEmail: Map<string, { id: string; first: string; last: string }>;
  message: ParsedMessage;
  unmatchedMode: "skip" | "stage";
  importantOnly: boolean;
}) {
  const matchedPeople = matchedPeopleForMessage(
    input.message,
    input.peopleByEmail,
    input.mailboxEmail,
  );
  // Outgoing mail is always relevant (you wrote it); incoming unmatched mail
  // must carry Gmail's IMPORTANT label when importantOnly is on.
  const relevant =
    input.message.direction === "outgoing" ||
    input.message.labelIds.includes("IMPORTANT");
  const contact = primaryContact(input.message, input.mailboxEmail);
  const summary =
    input.message.subject || input.message.snippet || "Gmail message";
  let createdInteractions = 0;
  let updatedInteractions = 0;
  let staged = 0;
  let skipped = 0;
  let firstInteractionId: string | null = null;
  let stagedItemId: string | null = null;

  if (matchedPeople.length) {
    for (const person of matchedPeople) {
      const result = await appendDailySourceInteraction({
        personId: person.id,
        source: SOURCE,
        sourceId: input.message.id,
        type: "email",
        timestamp: input.message.timestamp,
        summary,
        body: input.message.body ?? input.message.snippet,
        direction: input.message.direction,
        actor: input.actor,
      });
      if (!firstInteractionId) firstInteractionId = result.interactionId;
      if (result.created) createdInteractions += 1;
      else if (result.updated) updatedInteractions += 1;
      else skipped += 1;
      await auditAction({
        actor: input.actor,
        action: "interaction.create",
        targetType: "interaction",
        targetId: result.interactionId,
        metadata: {
          mode: result.created
            ? "gmail-sync-create"
            : result.updated
              ? "gmail-sync-append"
              : "gmail-sync-skip",
          source: SOURCE,
          gmailMessageId: input.message.id,
          threadId: input.message.threadId,
          personId: person.id,
          personName: personName(person),
          subject: input.message.subject,
        },
      });
    }
  } else if (
    input.unmatchedMode === "stage" &&
    (!input.importantOnly || relevant)
  ) {
    const stagedItem = await stageRecord(
      {
        source: SOURCE,
        sourceId: input.message.id,
        itemType: "interaction",
        type: "email",
        timestamp: input.message.timestamp,
        summary,
        body: input.message.body ?? input.message.snippet,
        direction: input.message.direction,
        contactName: contact?.name ?? null,
        contactEmail: contact?.email ?? null,
        confidence: null,
        matchReason:
          "No existing Person matched Gmail sender or recipients by email",
        metadata: input.message.metadata,
        trigger: "gmail.message.unmatched",
      },
      input.actor,
    );
    stagedItemId = stagedItem.id;
    staged += 1;
  } else {
    skipped += 1;
  }

  await db.gmailMessageLink.upsert({
    where: {
      workspaceId_provider_mailboxId_externalMessageId: {
        workspaceId: input.workspaceId,
        provider: "google",
        mailboxId: input.mailboxId,
        externalMessageId: input.message.id,
      },
    },
    update: {
      connectionId: input.connectionId,
      threadId: input.message.threadId,
      historyId: input.message.historyId,
      interactionId: firstInteractionId,
      stagedItemId,
      status: matchedPeople.length
        ? "matched"
        : input.unmatchedMode === "stage"
          ? "staged"
          : "skipped",
      lastSeenAt: new Date(),
    },
    create: {
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      provider: "google",
      mailboxId: input.mailboxId,
      externalMessageId: input.message.id,
      threadId: input.message.threadId,
      historyId: input.message.historyId,
      interactionId: firstInteractionId,
      stagedItemId,
      status: matchedPeople.length
        ? "matched"
        : input.unmatchedMode === "stage"
          ? "staged"
          : "skipped",
      lastSeenAt: new Date(),
    },
  });

  return { createdInteractions, updatedInteractions, staged, skipped };
}

// Reads the trigger-maintained PersonContact key index (no Person rows, no
// JSON parsing) instead of every Person in the workspace. Keys are the
// matcher's normalized form; parties are normalized the same way at lookup.
async function peopleEmailIndex(workspaceId: string) {
  return workspaceEmailIndex(workspaceId);
}

function matchedPeopleForMessage(
  message: ParsedMessage,
  peopleByEmail: Map<string, { id: string; first: string; last: string }>,
  mailboxEmail: string | null,
) {
  const self = mailboxEmail ? normalizeEmail(mailboxEmail) : null;
  const seen = new Set<string>();
  const people: { id: string; first: string; last: string }[] = [];
  for (const party of allParties(message)) {
    const email = normalizeEmail(party.email);
    if (self && email === self) continue;
    const person = peopleByEmail.get(email);
    if (!person || seen.has(person.id)) continue;
    seen.add(person.id);
    people.push(person);
  }
  return people;
}

function primaryContact(message: ParsedMessage, mailboxEmail: string | null) {
  const self = mailboxEmail ? normalizeEmail(mailboxEmail) : null;
  return (
    allParties(message).find(
      (party) => !self || normalizeEmail(party.email) !== self,
    ) ?? null
  );
}

function allParties(message: ParsedMessage) {
  return [...message.from, ...message.to, ...message.cc, ...message.bcc];
}

async function markDeleted(
  connection: GmailConnectionShape,
  externalMessageId: string,
) {
  const existing = await db.gmailMessageLink.findUnique({
    where: {
      workspaceId_provider_mailboxId_externalMessageId: {
        workspaceId: connection.workspaceId,
        provider: "google",
        mailboxId: connection.mailboxId,
        externalMessageId,
      },
    },
    select: { id: true },
  });
  if (!existing) return 0;
  await db.gmailMessageLink.update({
    where: { id: existing.id },
    data: { status: "deleted", lastSeenAt: new Date() },
  });
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
    throw badRequest("Gmail connection has no refresh token");
  }
  const token = await refreshAccessToken(connection.refreshToken);
  await db.$transaction(async (tx) => {
    const updated = await tx.gmailConnection.update({
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
    await mirrorGmailConnection(tx, updated);
  });
  return token.access_token;
}

async function fetchMessage(accessToken: string, id: string) {
  const params = new URLSearchParams({ format: "full" });
  const res = await gmailFetch(
    `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(id)}?${params}`,
    accessToken,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Gmail message request failed (${res.status})`);
  return (await res.json()) as GmailMessage;
}

async function fetchGmailProfile(accessToken: string) {
  const res = await gmailFetch(`${GMAIL_BASE}/users/me/profile`, accessToken);
  if (!res.ok) throw new Error(`Gmail profile request failed (${res.status})`);
  return (await res.json()) as GmailProfile;
}

async function exchangeCode(code: string, redirectUri: string) {
  const clientId = gmailClientId();
  const clientSecret = gmailClientSecret();
  if (!clientId || !clientSecret)
    throw badRequest("Gmail OAuth is not configured");
  return await requestGoogleToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = gmailClientId();
  const clientSecret = gmailClientSecret();
  if (!clientId || !clientSecret)
    throw badRequest("Gmail OAuth is not configured");
  return await requestGoogleToken({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
}

const gmailFetch = googleFetch;

/**
 * Map a Google contact-group resourceName to its display name, so imported
 * contacts carry the user's own labels rather than opaque identifiers.
 * Failures are non-fatal — labels are enrichment, not the point of the import.
 */
async function fetchGoogleContactGroups(
  accessToken: string,
): Promise<Map<string, string>> {
  const groups = new Map<string, string>();
  let pageToken: string | null = null;
  try {
    do {
      const params = new URLSearchParams({ pageSize: "200" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await gmailFetch(
        `${GOOGLE_PEOPLE_BASE}/contactGroups?${params}`,
        accessToken,
      );
      if (!res.ok) return groups;
      const data = (await res.json()) as GoogleContactGroupsResponse;
      for (const group of data.contactGroups ?? []) {
        const label =
          cleanNullable(group.formattedName) ?? cleanNullable(group.name);
        if (group.resourceName && label) groups.set(group.resourceName, label);
      }
      pageToken = data.nextPageToken ?? null;
    } while (pageToken);
  } catch {
    // Labels are optional enrichment; never fail the import over them.
  }
  return groups;
}

/**
 * Google's "other contacts" — addresses auto-saved from mail that were never
 * added to the address book. A large source of real people.
 *
 * Requires `contacts.other.readonly`, which older connections were not granted.
 * Missing scope returns an empty list rather than an error, so an existing
 * connection keeps working and simply improves after a reconnect.
 */
async function fetchGoogleOtherContacts(
  accessToken: string,
  scope: string | null | undefined,
) {
  if (!hasGoogleOtherContactsScope(scope)) return [];
  const contacts: ReturnType<typeof googlePersonToParsedContact>[] = [];
  let pageToken: string | null = null;
  // otherContacts.list supports only this narrow readMask.
  const readMask = "names,emailAddresses,phoneNumbers,metadata";

  try {
    do {
      const params = new URLSearchParams({ pageSize: "1000", readMask });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await gmailFetch(
        `${GOOGLE_PEOPLE_BASE}/otherContacts?${params}`,
        accessToken,
      );
      if (!res.ok) return contacts;
      const data = (await res.json()) as GoogleOtherContactsResponse;
      for (const person of data.otherContacts ?? []) {
        const contact = googlePersonToParsedContact(person);
        if (contact.emails.length || contact.phones.length)
          contacts.push(contact);
      }
      pageToken = data.nextPageToken ?? null;
    } while (pageToken);
  } catch {
    // Same reasoning as groups: additive source, never fatal.
  }
  return contacts;
}

async function fetchGoogleContacts(accessToken: string, scope?: string | null) {
  const contacts: ReturnType<typeof googlePersonToParsedContact>[] = [];
  let pageToken: string | null = null;
  const personFields =
    "names,emailAddresses,phoneNumbers,organizations,birthdays,addresses,urls,biographies,memberships";

  const groupNames = await fetchGoogleContactGroups(accessToken);

  do {
    const params = new URLSearchParams({
      pageSize: "1000",
      personFields,
      sortOrder: "FIRST_NAME_ASCENDING",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gmailFetch(
      `${GOOGLE_PEOPLE_BASE}/people/me/connections?${params}`,
      accessToken,
    );
    if (!res.ok)
      throw new Error(`Google contacts request failed (${res.status})`);
    const data = (await res.json()) as GooglePeopleResponse;
    for (const person of data.connections ?? []) {
      const contact = googlePersonToParsedContact(person, groupNames);
      if (contact.first || contact.last || contact.email || contact.phone)
        contacts.push(contact);
    }
    pageToken = data.nextPageToken ?? null;
  } while (pageToken);

  // Auto-saved addresses come last so a real address-book entry wins the
  // primary slot when the review step merges them.
  const seen = new Set(
    contacts.map((contact) => contact.sourceId).filter(Boolean),
  );
  for (const other of await fetchGoogleOtherContacts(accessToken, scope)) {
    if (other.sourceId && seen.has(other.sourceId)) continue;
    contacts.push(other);
  }

  return contacts;
}

function googlePersonToParsedContact(
  person: GooglePerson,
  groupNames?: Map<string, string>,
) {
  const name = person.names?.[0];
  const organization = person.organizations?.[0];
  // Primary-flagged values sort first; every other address and number is kept,
  // because the secondary ones are the strongest dedupe evidence available.
  const byPrimaryFirst = <
    T extends { value?: string; metadata?: GoogleFieldMetadata },
  >(
    items: T[] | undefined,
  ) =>
    [
      ...(items ?? []).filter((item) => item.metadata?.primary),
      ...(items ?? []).filter((item) => !item.metadata?.primary),
    ].map((item) => cleanNullable(item.value));

  const identifiers = contactIdentifiers(
    byPrimaryFirst(person.emailAddresses),
    byPrimaryFirst(person.phoneNumbers),
  );
  const groups = (person.memberships ?? [])
    .map(
      (membership) =>
        membership.contactGroupMembership?.contactGroupResourceName,
    )
    .map((resourceName) =>
      resourceName ? groupNames?.get(resourceName) : null,
    )
    .filter((label): label is string => Boolean(label));
  const fullName =
    cleanNullable(name?.displayName) ??
    [name?.givenName, name?.familyName]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" ");
  const title = cleanNullable(organization?.title);
  const company = cleanNullable(organization?.name);
  const urls = (person.urls ?? [])
    .map((url) => url.value?.trim())
    .filter((value): value is string => Boolean(value));
  const linkedin =
    urls.find((url) => url.toLowerCase().includes("linkedin.com")) ?? null;
  const twitter =
    urls.find((url) => {
      const lower = url.toLowerCase();
      return lower.includes("twitter.com") || lower.includes("x.com");
    }) ?? null;
  const facebook =
    urls.find((url) => {
      const lower = url.toLowerCase();
      return lower.includes("facebook.com") || lower.includes("fb.com");
    }) ?? null;
  const instagram =
    urls.find((url) => url.toLowerCase().includes("instagram.com")) ?? null;
  const website =
    urls.find(
      (url) =>
        url !== linkedin &&
        url !== twitter &&
        url !== facebook &&
        url !== instagram,
    ) ?? null;
  const address = person.addresses?.[0];
  const structuredLocation = [address?.city, address?.region, address?.country]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(", ");
  const location =
    cleanNullable(address?.formattedValue) ?? cleanNullable(structuredLocation);

  return {
    first: cleanNullable(name?.givenName) ?? firstFromFullName(fullName),
    last: cleanNullable(name?.familyName) ?? lastFromFullName(fullName),
    fullName:
      fullName ||
      [name?.givenName, name?.familyName]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(" "),
    title,
    headline: title && company ? `${title} at ${company}` : (title ?? company),
    company,
    ...identifiers,
    birthday: googleBirthday(person.birthdays?.[0]?.date),
    notes: cleanNullable(person.biographies?.[0]?.value),
    location,
    linkedin,
    twitter,
    website,
    facebook,
    instagram,
    sourceId: cleanNullable(person.resourceName),
    sourceEtag: cleanNullable(person.etag),
    groups,
  } satisfies ParsedContact;
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
  if (!payload || !signature) throw badRequest("Invalid Gmail state");
  const expected = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  if (signature !== expected) throw forbidden("Invalid Gmail state signature");
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as OAuthState;
}

function gmailRedirectUri(origin: string | null) {
  const explicit =
    process.env.GOOGLE_GMAIL_REDIRECT_URI || process.env.GMAIL_REDIRECT_URI;
  if (explicit) return explicit;
  const base =
    process.env.HOME_URL?.trim() ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    vercelProductionUrl() ||
    origin;
  if (!base) throw badRequest("Gmail redirect URI could not be resolved");
  return `${base.replace(/\/$/, "")}/admin/connections/google/gmail/callback`;
}

function homeConnectionsUrl() {
  const base =
    process.env.HOME_URL?.trim() ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    vercelProductionUrl() ||
    "http://localhost:3003";
  return `${base.replace(/\/$/, "")}/admin/connections`;
}

function stateSecret() {
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "dev-gmail-state-secret"
  );
}

function gmailClientId() {
  return (
    process.env.GOOGLE_GMAIL_CLIENT_ID ||
    process.env.GMAIL_GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    null
  );
}

function gmailClientSecret() {
  return (
    process.env.GOOGLE_GMAIL_CLIENT_SECRET ||
    process.env.GMAIL_GOOGLE_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    null
  );
}

function vercelProductionUrl() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : null;
}

function normalizeBackfillDays(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_BACKFILL_DAYS;
  const days = Math.round(value);
  if (days < 1) return DEFAULT_BACKFILL_DAYS;
  if (days >= ALL_TIME_BACKFILL_DAYS) return ALL_TIME_BACKFILL_DAYS;
  return Math.min(days, MAX_BACKFILL_DAYS);
}

function hasGoogleContactsScope(scope: string | null | undefined) {
  return (scope ?? "").split(/\s+/).includes(GOOGLE_CONTACTS_READONLY_SCOPE);
}

function hasGoogleOtherContactsScope(scope: string | null | undefined) {
  return (scope ?? "")
    .split(/\s+/)
    .includes(GOOGLE_OTHER_CONTACTS_READONLY_SCOPE);
}

function cleanNullable(value: string | null | undefined) {
  const clean = value?.trim();
  return clean ? clean : null;
}

function firstFromFullName(value: string | null) {
  return value?.split(/\s+/)[0] ?? "";
}

function lastFromFullName(value: string | null) {
  const parts = value?.split(/\s+/) ?? [];
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

function googleBirthday(date: GoogleBirthdayDate | undefined) {
  if (!date?.month || !date.day) return null;
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return date.year ? `${date.year}-${month}-${day}` : `--${month}-${day}`;
}

function parseJsonList(value: string | null) {
  return decodeStoredJson(value, storedStringList, "Person.emails", []);
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

function parseGmailMetadata(
  value: string | null | undefined,
): GmailMessageMetadata {
  return decodeStoredJson(
    value,
    gmailMessageMetadataContract,
    "Gmail.messageMetadata",
    {},
  ) as GmailMessageMetadata;
}

// Same normalization the PersonContact index stores (lowercase, +tag
// stripped, Gmail dots collapsed), so a party email finds its Person even
// when the saved address was written differently. Falls back to a plain
// lowercase for strings that are not well-formed addresses.
function normalizeEmail(value: string) {
  return normalizeEmailForMatch(value) ?? value.trim().toLowerCase();
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

function dedupeInteractions<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

type GmailConnectionShape = {
  id: string;
  workspaceId: string;
  userId: string;
  provider: string;
  status: string;
  accountEmail: string | null;
  mailboxId: string;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
  scope: string | null;
  historyId: string | null;
};
