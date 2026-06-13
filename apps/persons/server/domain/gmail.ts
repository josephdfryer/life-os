import { createHmac, randomBytes } from "crypto"
import { db } from "@/lib/db"
import { badRequest, forbidden, notFound } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import type { AccessActor } from "./access"
import { stageRecord } from "./inbox"
import { appendDailySourceInteraction } from "./interactions"
import { sourceMarkers } from "./idempotency"

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1"
const GOOGLE_PEOPLE_BASE = "https://people.googleapis.com/v1"
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
const GOOGLE_CONTACTS_READONLY_SCOPE = "https://www.googleapis.com/auth/contacts.readonly"
const GMAIL_SCOPE = `${GMAIL_READONLY_SCOPE} ${GOOGLE_CONTACTS_READONLY_SCOPE}`
const SOURCE = "gmail"
const DEFAULT_BACKFILL_DAYS = 30
const MAX_BACKFILL_DAYS = 3650
const ALL_TIME_BACKFILL_DAYS = 36500
const GMAIL_PAGE_SIZE = 100
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
}

type GmailProfile = {
  emailAddress?: string
  historyId?: string
}

type GooglePeopleResponse = {
  connections?: GooglePerson[]
  nextPageToken?: string
}

type GooglePerson = {
  names?: { displayName?: string; givenName?: string; familyName?: string }[]
  emailAddresses?: { value?: string }[]
  phoneNumbers?: { value?: string }[]
  organizations?: { name?: string; title?: string }[]
  birthdays?: { date?: GoogleBirthdayDate }[]
  addresses?: { formattedValue?: string; city?: string; region?: string; country?: string }[]
  urls?: { value?: string }[]
  biographies?: { value?: string }[]
}

type GoogleBirthdayDate = { year?: number; month?: number; day?: number }

type GmailListResponse = {
  messages?: { id: string; threadId?: string }[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

type GmailHistoryResponse = {
  history?: {
    id?: string
    messagesAdded?: { message?: { id?: string; threadId?: string } }[]
    messagesDeleted?: { message?: { id?: string; threadId?: string } }[]
  }[]
  nextPageToken?: string
  historyId?: string
}

type GmailMessage = {
  id: string
  threadId?: string
  historyId?: string
  internalDate?: string
  labelIds?: string[]
  snippet?: string
  payload?: {
    mimeType?: string
    headers?: { name?: string; value?: string }[]
    body?: { data?: string }
    parts?: GmailMessage["payload"][]
  }
}

type EmailParty = {
  name: string | null
  email: string
}

type ParsedMessage = {
  id: string
  threadId: string | null
  historyId: string | null
  subject: string | null
  from: EmailParty[]
  to: EmailParty[]
  cc: EmailParty[]
  bcc: EmailParty[]
  timestamp: Date
  snippet: string | null
  body: string | null
  direction: string
  metadata: Record<string, unknown>
}

type GmailMessageMetadata = {
  subject?: string | null
  from?: EmailParty[]
  to?: EmailParty[]
  cc?: EmailParty[]
  bcc?: EmailParty[]
  snippet?: string | null
  threadId?: string | null
  historyId?: string | null
}

type SyncOptions = {
  backfillDays?: number | null
  unmatchedMode?: "skip" | "stage" | null
}

type SyncStats = {
  createdInteractions: number
  updatedInteractions: number
  staged: number
  skipped: number
  deleted: number
  fetched: number
  batches: number
  backfillDays: number
  incremental: boolean
  unmatchedMode: "skip" | "stage"
}

export function gmailConfigured() {
  return Boolean(gmailClientId() && gmailClientSecret())
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
  })

  return {
    configured: gmailConfigured(),
    redirectUri: gmailRedirectUri(null),
    connection: connection ? {
      ...connection,
      messageCount: connection._count.messageLinks,
      _count: undefined,
    } : null,
  }
}

export async function gmailTrace(actor: AccessActor, options: { limit?: number } = {}) {
  const limit = normalizeTraceLimit(options.limit)
  const connection = await db.gmailConnection.findFirst({
    where: { workspaceId: actor.workspaceId, provider: "google" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, mailboxId: true, accountEmail: true },
  })

  const runs = await db.auditLog.findMany({
    where: { workspaceId: actor.workspaceId, action: "gmail.sync" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, actorLabel: true, metadata: true },
  })

  const links = connection ? await db.gmailMessageLink.findMany({
    where: { workspaceId: actor.workspaceId, provider: "google", connectionId: connection.id },
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
          person: { select: { id: true, first: true, last: true, emails: true } },
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
          candidatePerson: { select: { id: true, first: true, last: true, emails: true } },
        },
      },
    },
  }) : []

  const recentInteractions = await db.interaction.findMany({
    where: { workspaceId: actor.workspaceId, type: "email", notes: { contains: `${SOURCE}:` } },
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
  })
  const interactionsByMessage = new Map<string, typeof recentInteractions>()
  for (const interaction of recentInteractions) {
    for (const marker of sourceMarkers(interaction.notes)) {
      if (!marker.startsWith(`${SOURCE}:`)) continue
      const messageId = marker.slice(`${SOURCE}:`.length)
      interactionsByMessage.set(messageId, [...(interactionsByMessage.get(messageId) ?? []), interaction])
    }
  }

  return {
    connection,
    runs: runs.map(run => ({
      id: run.id,
      createdAt: run.createdAt,
      actorLabel: run.actorLabel,
      metadata: parseJsonObject(run.metadata),
    })),
    messages: links.map(link => {
      const stagedMetadata = parseGmailMetadata(link.stagedItem?.metadata)
      const linkedInteractions = dedupeInteractions([
        ...(interactionsByMessage.get(link.externalMessageId) ?? []),
        ...(link.interaction ? [link.interaction] : []),
      ]).map(interaction => ({
        id: interaction.id,
        createdAt: interaction.createdAt,
        timestamp: interaction.timestamp,
        summary: interaction.summary,
        direction: interaction.direction,
        person: interaction.person ? {
          id: interaction.person.id,
          name: personName(interaction.person),
          emails: parseJsonList(interaction.person.emails),
        } : null,
      }))

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
        subject: stagedMetadata.subject ?? link.stagedItem?.summary ?? link.interaction?.summary ?? null,
        snippet: stagedMetadata.snippet ?? null,
        from: stagedMetadata.from ?? [],
        to: stagedMetadata.to ?? [],
        linkedPeople: linkedInteractions,
        stagedItem: link.stagedItem ? {
          id: link.stagedItem.id,
          status: link.stagedItem.status,
          createdAt: link.stagedItem.createdAt,
          updatedAt: link.stagedItem.updatedAt,
          timestamp: link.stagedItem.timestamp,
          contactName: link.stagedItem.contactName,
          contactEmail: link.stagedItem.contactEmail,
          summary: link.stagedItem.summary,
          direction: link.stagedItem.direction,
          candidatePerson: link.stagedItem.candidatePerson ? {
            id: link.stagedItem.candidatePerson.id,
            name: personName(link.stagedItem.candidatePerson),
            emails: parseJsonList(link.stagedItem.candidatePerson.emails),
          } : null,
        } : null,
      }
    }),
  }
}

export async function importGmailContactsPreview(actor: AccessActor) {
  const connection = await db.gmailConnection.findFirst({
    where: { workspaceId: actor.workspaceId, provider: "google", status: "active" },
    orderBy: { updatedAt: "desc" },
  })
  if (!connection) throw notFound("Gmail is not connected")
  if (!hasGoogleContactsScope(connection.scope)) {
    throw badRequest("Reconnect Gmail to allow importing Google contacts", {
      reconnectRequired: true,
      missingScope: GOOGLE_CONTACTS_READONLY_SCOPE,
      reconnectUrl: "/api/gmail/google/connect?returnTo=/import/people",
    })
  }

  const accessToken = await usableAccessToken(connection)
  const contacts = await fetchGoogleContacts(accessToken)
  return { contacts, count: contacts.length, method: "google-contacts", accountEmail: connection.accountEmail }
}

export function gmailAuthUrl(actor: AccessActor, origin: string, returnTo = "/admin") {
  const clientId = gmailClientId()
  if (!clientId || !gmailClientSecret()) throw badRequest("Gmail OAuth is not configured")
  const redirectUri = gmailRedirectUri(origin)
  const state = signState({ workspaceId: actor.workspaceId, userId: actor.userId, nonce: randomBytes(12).toString("hex"), returnTo })
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export async function handleGmailCallback(input: { code: string; state: string; origin: string }) {
  const state = verifyState(input.state)
  const token = await exchangeCode(input.code, gmailRedirectUri(input.origin))
  if (!token.refresh_token) {
    throw badRequest("Google did not return a refresh token. Reconnect Gmail and approve offline access.")
  }

  const profile = await fetchGmailProfile(token.access_token)
  const accountEmail = profile.emailAddress ?? null
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null
  const mailboxId = "me"

  const connection = await db.gmailConnection.upsert({
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
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
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
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
      scope: token.scope ?? GMAIL_SCOPE,
    },
  })

  await auditAction({
    actor: { type: "user", id: state.userId, workspaceId: state.workspaceId },
    action: "gmail.connect",
    targetType: "gmailConnection",
    targetId: connection.id,
    metadata: { provider: "google", accountEmail, mailboxId },
  })

  return { returnTo: state.returnTo, connectionId: connection.id }
}

export async function syncGmail(actor: AccessActor, options: SyncOptions = {}) {
  const connection = await db.gmailConnection.findFirst({
    where: { workspaceId: actor.workspaceId, provider: "google", status: "active" },
    orderBy: { updatedAt: "desc" },
  })
  if (!connection) throw notFound("Gmail is not connected")
  if (!connection.refreshToken && !connection.accessToken) throw badRequest("Gmail connection has no usable token")

  const accessToken = await usableAccessToken(connection)
  const backfillDays = normalizeBackfillDays(options.backfillDays)
  const unmatchedMode = options.unmatchedMode === "stage" ? "stage" : "skip"

  try {
    const peopleByEmail = await peopleEmailIndex(actor.workspaceId)
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
    }

    const listed = connection.historyId
      ? await syncHistoryPages(accessToken, {
        connection,
        actor: actor.actor,
        peopleByEmail,
        stats,
        unmatchedMode,
      })
      : await syncMessagePages(accessToken, {
        connection,
        actor: actor.actor,
        peopleByEmail,
        stats,
        backfillDays,
        unmatchedMode,
      })

    const profile = await fetchGmailProfile(accessToken)
    await db.gmailConnection.update({
      where: { id: connection.id },
      data: {
        historyId: listed.historyId ?? profile.historyId ?? connection.historyId,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    })

    await auditAction({
      actor: actor.actor,
      action: "gmail.sync",
      targetType: "gmailConnection",
      targetId: connection.id,
      metadata: { provider: "google", ...stats },
    })

    return stats
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail sync failed"
    await db.gmailConnection.update({ where: { id: connection.id }, data: { lastError: message } })
    throw error
  }
}

async function syncMessagePages(
  accessToken: string,
  input: {
    connection: GmailConnectionShape
    actor: DomainActor
    peopleByEmail: Map<string, { id: string; first: string; last: string }>
    stats: SyncStats
    backfillDays: number
    unmatchedMode: "skip" | "stage"
  }
) {
  let pageToken: string | undefined
  let newestHistoryId: string | null = null
  const after = Math.floor((Date.now() - input.backfillDays * 24 * 60 * 60 * 1000) / 1000)

  for (;;) {
    const params = new URLSearchParams({
      maxResults: String(GMAIL_PAGE_SIZE),
      q: `after:${after} -in:spam -in:trash`,
      includeSpamTrash: "false",
    })
    if (pageToken) params.set("pageToken", pageToken)
    const res = await gmailFetch(`${GMAIL_BASE}/users/me/messages?${params}`, accessToken)
    if (!res.ok) throw new Error(`Gmail messages request failed (${res.status})`)
    const data = await res.json() as GmailListResponse
    const ids = (data.messages ?? []).map(message => message.id).filter(Boolean)
    for (const batch of chunk(ids, DB_BATCH_SIZE)) {
      input.stats.batches += 1
      const result = await processMessageBatch(accessToken, { ...input, messageIds: batch })
      newestHistoryId = result.historyId ?? newestHistoryId
    }
    pageToken = data.nextPageToken
    if (!pageToken) break
  }

  return { historyId: newestHistoryId }
}

async function syncHistoryPages(
  accessToken: string,
  input: {
    connection: GmailConnectionShape
    actor: DomainActor
    peopleByEmail: Map<string, { id: string; first: string; last: string }>
    stats: SyncStats
    unmatchedMode: "skip" | "stage"
  }
) {
  let pageToken: string | undefined
  let nextHistoryId: string | null = null

  for (;;) {
    const params = new URLSearchParams({
      maxResults: String(GMAIL_PAGE_SIZE),
      startHistoryId: input.connection.historyId ?? "",
      historyTypes: "messageAdded",
    })
    if (pageToken) params.set("pageToken", pageToken)
    const res = await gmailFetch(`${GMAIL_BASE}/users/me/history?${params}`, accessToken)
    if (res.status === 404) {
      input.stats.incremental = false
      return await syncMessagePages(accessToken, { ...input, backfillDays: DEFAULT_BACKFILL_DAYS })
    }
    if (!res.ok) throw new Error(`Gmail history request failed (${res.status})`)
    const data = await res.json() as GmailHistoryResponse
    const messageIds = new Set<string>()
    const deletedIds = new Set<string>()
    for (const history of data.history ?? []) {
      for (const added of history.messagesAdded ?? []) {
        if (added.message?.id) messageIds.add(added.message.id)
      }
      for (const deleted of history.messagesDeleted ?? []) {
        if (deleted.message?.id) deletedIds.add(deleted.message.id)
      }
    }
    for (const id of deletedIds) {
      input.stats.deleted += await markDeleted(input.connection, id)
    }
    for (const batch of chunk([...messageIds], DB_BATCH_SIZE)) {
      input.stats.batches += 1
      await processMessageBatch(accessToken, { ...input, messageIds: batch })
    }
    nextHistoryId = data.historyId ?? nextHistoryId
    pageToken = data.nextPageToken
    if (!pageToken) break
  }

  return { historyId: nextHistoryId }
}

async function processMessageBatch(
  accessToken: string,
  input: {
    connection: GmailConnectionShape
    actor: DomainActor
    peopleByEmail: Map<string, { id: string; first: string; last: string }>
    stats: SyncStats
    messageIds: string[]
    unmatchedMode: "skip" | "stage"
  }
) {
  let newestHistoryId: string | null = null
  for (const messageId of input.messageIds) {
    const raw = await fetchMessage(accessToken, messageId)
    if (!raw) {
      input.stats.skipped += 1
      continue
    }
    newestHistoryId = raw.historyId ?? newestHistoryId
    const message = parseMessage(raw, input.connection.accountEmail)
    input.stats.fetched += 1
    const result = await importMessage({
      actor: input.actor,
      workspaceId: input.connection.workspaceId,
      connectionId: input.connection.id,
      mailboxId: input.connection.mailboxId,
      mailboxEmail: input.connection.accountEmail,
      peopleByEmail: input.peopleByEmail,
      message,
      unmatchedMode: input.unmatchedMode,
    })
    input.stats.createdInteractions += result.createdInteractions
    input.stats.updatedInteractions += result.updatedInteractions
    input.stats.staged += result.staged
    input.stats.skipped += result.skipped
  }
  return { historyId: newestHistoryId }
}

async function importMessage(input: {
  actor: DomainActor
  workspaceId: string
  connectionId: string
  mailboxId: string
  mailboxEmail: string | null
  peopleByEmail: Map<string, { id: string; first: string; last: string }>
  message: ParsedMessage
  unmatchedMode: "skip" | "stage"
}) {
  const matchedPeople = matchedPeopleForMessage(input.message, input.peopleByEmail, input.mailboxEmail)
  const contact = primaryContact(input.message, input.mailboxEmail)
  const summary = input.message.subject || input.message.snippet || "Gmail message"
  let createdInteractions = 0
  let updatedInteractions = 0
  let staged = 0
  let skipped = 0
  let firstInteractionId: string | null = null
  let stagedItemId: string | null = null

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
      })
      if (!firstInteractionId) firstInteractionId = result.interactionId
      if (result.created) createdInteractions += 1
      else if (result.updated) updatedInteractions += 1
      else skipped += 1
      await auditAction({
        actor: input.actor,
        action: "interaction.create",
        targetType: "interaction",
        targetId: result.interactionId,
        metadata: {
          mode: result.created ? "gmail-sync-create" : result.updated ? "gmail-sync-append" : "gmail-sync-skip",
          source: SOURCE,
          gmailMessageId: input.message.id,
          threadId: input.message.threadId,
          personId: person.id,
          personName: personName(person),
          subject: input.message.subject,
        },
      })
    }
  } else if (input.unmatchedMode === "stage") {
    const stagedItem = await stageRecord({
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
      matchReason: "No existing Person matched Gmail sender or recipients by email",
      metadata: input.message.metadata,
      trigger: "gmail.message.unmatched",
    }, input.actor)
    stagedItemId = stagedItem.id
    staged += 1
  } else {
    skipped += 1
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
      status: matchedPeople.length ? "matched" : input.unmatchedMode === "stage" ? "staged" : "skipped",
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
      status: matchedPeople.length ? "matched" : input.unmatchedMode === "stage" ? "staged" : "skipped",
      lastSeenAt: new Date(),
    },
  })

  return { createdInteractions, updatedInteractions, staged, skipped }
}

async function peopleEmailIndex(workspaceId: string) {
  const rows = await db.person.findMany({
    where: { workspaceId },
    select: { id: true, first: true, last: true, emails: true },
  })
  const byEmail = new Map<string, { id: string; first: string; last: string }>()
  for (const row of rows) {
    for (const email of parseJsonList(row.emails)) byEmail.set(normalizeEmail(email), row)
  }
  return byEmail
}

function matchedPeopleForMessage(message: ParsedMessage, peopleByEmail: Map<string, { id: string; first: string; last: string }>, mailboxEmail: string | null) {
  const self = mailboxEmail ? normalizeEmail(mailboxEmail) : null
  const seen = new Set<string>()
  const people: { id: string; first: string; last: string }[] = []
  for (const party of allParties(message)) {
    const email = normalizeEmail(party.email)
    if (self && email === self) continue
    const person = peopleByEmail.get(email)
    if (!person || seen.has(person.id)) continue
    seen.add(person.id)
    people.push(person)
  }
  return people
}

function primaryContact(message: ParsedMessage, mailboxEmail: string | null) {
  const self = mailboxEmail ? normalizeEmail(mailboxEmail) : null
  return allParties(message).find(party => !self || normalizeEmail(party.email) !== self) ?? null
}

function allParties(message: ParsedMessage) {
  return [...message.from, ...message.to, ...message.cc, ...message.bcc]
}

async function markDeleted(connection: GmailConnectionShape, externalMessageId: string) {
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
  })
  if (!existing) return 0
  await db.gmailMessageLink.update({ where: { id: existing.id }, data: { status: "deleted", lastSeenAt: new Date() } })
  return 1
}

async function usableAccessToken(connection: { id: string; accessToken: string | null; refreshToken: string | null; expiresAt: Date | null }) {
  if (connection.accessToken && connection.expiresAt && connection.expiresAt.getTime() > Date.now() + 60_000) {
    return connection.accessToken
  }
  if (!connection.refreshToken) {
    if (connection.accessToken) return connection.accessToken
    throw badRequest("Gmail connection has no refresh token")
  }
  const token = await refreshAccessToken(connection.refreshToken)
  await db.gmailConnection.update({
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

async function fetchMessage(accessToken: string, id: string) {
  const params = new URLSearchParams({ format: "full" })
  const res = await gmailFetch(`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(id)}?${params}`, accessToken)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Gmail message request failed (${res.status})`)
  return await res.json() as GmailMessage
}

async function fetchGmailProfile(accessToken: string) {
  const res = await gmailFetch(`${GMAIL_BASE}/users/me/profile`, accessToken)
  if (!res.ok) throw new Error(`Gmail profile request failed (${res.status})`)
  return await res.json() as GmailProfile
}

async function exchangeCode(code: string, redirectUri: string) {
  const clientId = gmailClientId()
  const clientSecret = gmailClientSecret()
  if (!clientId || !clientSecret) throw badRequest("Gmail OAuth is not configured")
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
  const clientId = gmailClientId()
  const clientSecret = gmailClientSecret()
  if (!clientId || !clientSecret) throw badRequest("Gmail OAuth is not configured")
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

function parseMessage(raw: GmailMessage, mailboxEmail: string | null): ParsedMessage {
  const headers = headersMap(raw.payload?.headers ?? [])
  const timestamp = parseTimestamp(headers.get("date") ?? null, raw.internalDate)
  const from = parseAddressList(headers.get("from"))
  const to = parseAddressList(headers.get("to"))
  const cc = parseAddressList(headers.get("cc"))
  const bcc = parseAddressList(headers.get("bcc"))
  const self = mailboxEmail ? normalizeEmail(mailboxEmail) : null
  const fromSelf = self ? from.some(party => normalizeEmail(party.email) === self) : Boolean(raw.labelIds?.includes("SENT"))
  const body = extractBody(raw.payload) ?? raw.snippet ?? null

  return {
    id: raw.id,
    threadId: raw.threadId ?? null,
    historyId: raw.historyId ?? null,
    subject: headers.get("subject") ?? null,
    from,
    to,
    cc,
    bcc,
    timestamp,
    snippet: raw.snippet ?? null,
    body,
    direction: fromSelf ? "outgoing" : "incoming",
    metadata: {
      source: SOURCE,
      gmailMessageId: raw.id,
      threadId: raw.threadId ?? null,
      historyId: raw.historyId ?? null,
      labelIds: raw.labelIds ?? [],
      subject: headers.get("subject") ?? null,
      from,
      to,
      cc,
      bcc,
      snippet: raw.snippet ?? null,
    },
  }
}

function headersMap(headers: { name?: string; value?: string }[]) {
  const map = new Map<string, string>()
  for (const header of headers) {
    if (!header.name || header.value === undefined) continue
    map.set(header.name.toLowerCase(), header.value)
  }
  return map
}

function parseTimestamp(dateHeader: string | null, internalDate: string | undefined) {
  const fromHeader = dateHeader ? new Date(dateHeader) : null
  if (fromHeader && !Number.isNaN(fromHeader.getTime())) return fromHeader
  const millis = internalDate ? Number(internalDate) : NaN
  const fromInternal = Number.isFinite(millis) ? new Date(millis) : null
  return fromInternal && !Number.isNaN(fromInternal.getTime()) ? fromInternal : new Date()
}

function parseAddressList(value: string | null | undefined) {
  if (!value) return []
  return value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map(part => part.trim())
    .map(parseAddress)
    .filter((party): party is EmailParty => Boolean(party?.email))
}

function parseAddress(value: string) {
  const bracket = value.match(/^(.*)<([^>]+)>$/)
  if (bracket) {
    return {
      name: cleanName(bracket[1]),
      email: bracket[2].trim().toLowerCase(),
    }
  }
  const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  if (!email) return null
  return { name: cleanName(value.replace(email, "")), email: email.toLowerCase() }
}

function cleanName(value: string) {
  const cleaned = value.trim().replace(/^"+|"+$/g, "").trim()
  return cleaned || null
}

function extractBody(part: GmailMessage["payload"]): string | null {
  if (!part) return null
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data)
  for (const child of part.parts ?? []) {
    const text = extractBody(child)
    if (text) return text
  }
  if (part.body?.data && part.mimeType?.startsWith("text/")) return decodeBase64Url(part.body.data)
  return null
}

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").trim()
}

function gmailFetch(url: string, accessToken: string) {
  return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
}

async function fetchGoogleContacts(accessToken: string) {
  const contacts: ReturnType<typeof googlePersonToParsedContact>[] = []
  let pageToken: string | null = null
  const personFields = "names,emailAddresses,phoneNumbers,organizations,birthdays,addresses,urls,biographies"

  do {
    const params = new URLSearchParams({
      pageSize: "1000",
      personFields,
      sortOrder: "FIRST_NAME_ASCENDING",
    })
    if (pageToken) params.set("pageToken", pageToken)
    const res = await gmailFetch(`${GOOGLE_PEOPLE_BASE}/people/me/connections?${params}`, accessToken)
    if (!res.ok) throw new Error(`Google contacts request failed (${res.status})`)
    const data = await res.json() as GooglePeopleResponse
    for (const person of data.connections ?? []) {
      const contact = googlePersonToParsedContact(person)
      if (contact.first || contact.last || contact.email || contact.phone) contacts.push(contact)
    }
    pageToken = data.nextPageToken ?? null
  } while (pageToken)

  return contacts
}

function googlePersonToParsedContact(person: GooglePerson) {
  const name = person.names?.[0]
  const organization = person.organizations?.[0]
  const email = cleanNullable(person.emailAddresses?.find(item => item.value)?.value)
  const phone = cleanNullable(person.phoneNumbers?.find(item => item.value)?.value)
  const fullName = cleanNullable(name?.displayName)
    ?? [name?.givenName, name?.familyName].map(value => value?.trim()).filter(Boolean).join(" ")
  const title = cleanNullable(organization?.title)
  const company = cleanNullable(organization?.name)
  const urls = (person.urls ?? []).map(url => url.value?.trim()).filter((value): value is string => Boolean(value))
  const linkedin = urls.find(url => url.toLowerCase().includes("linkedin.com")) ?? null
  const twitter = urls.find(url => {
    const lower = url.toLowerCase()
    return lower.includes("twitter.com") || lower.includes("x.com")
  }) ?? null
  const website = urls.find(url => url !== linkedin && url !== twitter) ?? null
  const address = person.addresses?.[0]
  const structuredLocation = [address?.city, address?.region, address?.country].map(value => value?.trim()).filter(Boolean).join(", ")
  const location = cleanNullable(address?.formattedValue) ?? cleanNullable(structuredLocation)

  return {
    first: cleanNullable(name?.givenName) ?? firstFromFullName(fullName),
    last: cleanNullable(name?.familyName) ?? lastFromFullName(fullName),
    fullName: fullName || [name?.givenName, name?.familyName].map(value => value?.trim()).filter(Boolean).join(" "),
    title,
    headline: title && company ? `${title} at ${company}` : title ?? company,
    company,
    email,
    phone,
    birthday: googleBirthday(person.birthdays?.[0]?.date),
    notes: cleanNullable(person.biographies?.[0]?.value),
    location,
    linkedin,
    twitter,
    website,
  }
}

function signState(state: OAuthState) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url")
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

function verifyState(value: string) {
  const [payload, signature] = value.split(".")
  if (!payload || !signature) throw badRequest("Invalid Gmail state")
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("base64url")
  if (signature !== expected) throw forbidden("Invalid Gmail state signature")
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState
}

function gmailRedirectUri(origin: string | null) {
  const explicit = process.env.GOOGLE_GMAIL_REDIRECT_URI || process.env.GMAIL_REDIRECT_URI
  if (explicit) return explicit
  const base = process.env.AUTH_URL
    || process.env.NEXTAUTH_URL
    || vercelProductionUrl()
    || origin
  if (!base) throw badRequest("Gmail redirect URI could not be resolved")
  return `${base.replace(/\/$/, "")}/api/gmail/google/callback`
}

function stateSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "dev-gmail-state-secret"
}

function gmailClientId() {
  return process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.GMAIL_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || null
}

function gmailClientSecret() {
  return process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GMAIL_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || null
}

function vercelProductionUrl() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return host ? `https://${host}` : null
}

function normalizeBackfillDays(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BACKFILL_DAYS
  const days = Math.round(value)
  if (days < 1) return DEFAULT_BACKFILL_DAYS
  if (days >= ALL_TIME_BACKFILL_DAYS) return ALL_TIME_BACKFILL_DAYS
  return Math.min(days, MAX_BACKFILL_DAYS)
}

function hasGoogleContactsScope(scope: string | null | undefined) {
  return (scope ?? "").split(/\s+/).includes(GOOGLE_CONTACTS_READONLY_SCOPE)
}

function cleanNullable(value: string | null | undefined) {
  const clean = value?.trim()
  return clean ? clean : null
}

function firstFromFullName(value: string | null) {
  return value?.split(/\s+/)[0] ?? ""
}

function lastFromFullName(value: string | null) {
  const parts = value?.split(/\s+/) ?? []
  return parts.length > 1 ? parts.slice(1).join(" ") : ""
}

function googleBirthday(date: GoogleBirthdayDate | undefined) {
  if (!date?.month || !date.day) return null
  const month = String(date.month).padStart(2, "0")
  const day = String(date.day).padStart(2, "0")
  return date.year ? `${date.year}-${month}-${day}` : `--${month}-${day}`
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

function parseGmailMetadata(value: string | null | undefined): GmailMessageMetadata {
  const parsed = parseJsonObject(value ?? null) as GmailMessageMetadata | null
  return parsed ?? {}
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
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

function dedupeInteractions<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

type GmailConnectionShape = {
  id: string
  workspaceId: string
  userId: string
  provider: string
  status: string
  accountEmail: string | null
  mailboxId: string
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
  scope: string | null
  historyId: string | null
}
