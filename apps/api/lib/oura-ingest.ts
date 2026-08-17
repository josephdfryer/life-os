import { decryptNullable, encryptNullable } from "@life-os/db/crypto"
import { ensureStateDefinition } from "@life-os/domain"
import { HEALTH_DAILY_TRANSACTION, recordHealthDailyDigestInTransaction, fireHealthDailyRules } from "./health-daily"
import {
  OURA_BACKFILL_DAYS,
  OURA_DAILY_COLLECTIONS,
  OuraError,
  createOuraWebhookSubscription,
  fetchOuraCollection,
  fetchOuraDocument,
  listOuraWebhookSubscriptions,
  refreshOuraTokens,
  revokeOuraToken,
  type OuraDailyCollection,
  type OuraDailyDocument,
  type OuraTokenResponse,
} from "./oura"

export const OURA_SOURCE = "oura"
export const OURA_CONTENT_LABEL = "Oura daily digest"

export const OURA_METRIC_TAXONOMY: Record<string, string> = {
  oura_readiness_score: "Oura readiness score (0-100)",
  oura_readiness_activity_balance: "Oura readiness contributor: activity balance",
  oura_readiness_body_temperature: "Oura readiness contributor: body temperature",
  oura_readiness_hrv_balance: "Oura readiness contributor: HRV balance",
  oura_readiness_previous_day_activity: "Oura readiness contributor: previous day activity",
  oura_readiness_previous_night: "Oura readiness contributor: previous night",
  oura_readiness_recovery_index: "Oura readiness contributor: recovery index",
  oura_readiness_resting_heart_rate: "Oura readiness contributor: resting heart rate",
  oura_readiness_sleep_balance: "Oura readiness contributor: sleep balance",
  oura_sleep_score: "Oura sleep score (0-100)",
  oura_sleep_deep_sleep: "Oura sleep contributor: deep sleep",
  oura_sleep_efficiency: "Oura sleep contributor: efficiency",
  oura_sleep_latency: "Oura sleep contributor: latency",
  oura_sleep_rem_sleep: "Oura sleep contributor: REM sleep",
  oura_sleep_restfulness: "Oura sleep contributor: restfulness",
  oura_sleep_timing: "Oura sleep contributor: timing",
  oura_sleep_total_sleep: "Oura sleep contributor: total sleep",
  oura_activity_score: "Oura activity score (0-100)",
  oura_activity_meet_daily_targets: "Oura activity contributor: meet daily targets",
  oura_activity_move_every_hour: "Oura activity contributor: move every hour",
  oura_activity_recovery_time: "Oura activity contributor: recovery time",
  oura_activity_stay_active: "Oura activity contributor: stay active",
  oura_activity_training_frequency: "Oura activity contributor: training frequency",
  oura_activity_training_volume: "Oura activity contributor: training volume",
  oura_stress_high_seconds: "Oura time in high stress (seconds)",
  oura_recovery_high_seconds: "Oura time in high recovery (seconds)",
  oura_stress_summary: "Oura day summary (1=restored, 2=normal, 3=stressful)",
}

const STRESS_SUMMARY: Record<string, number> = { restored: 1, normal: 2, stressful: 3 }
const WEBHOOK_DATA_TYPES = ["daily_readiness", "daily_sleep", "daily_activity", "daily_stress"] as const
const ACTOR = { type: "system" as const, label: "oura" }

export type OuraDayDocuments = {
  daily_readiness?: OuraDailyDocument | null
  daily_sleep?: OuraDailyDocument | null
  daily_activity?: OuraDailyDocument | null
  daily_stress?: OuraDailyDocument | null
}

export type OuraConnectionRow = {
  id: string
  workspaceId: string
  userId: string | null
  accessTokenEncrypted: string | null
  refreshTokenEncrypted: string | null
  expiresAt: Date | null
  scope: string | null
  metadata: string | null
  status: string
}

export function ouraDayMarker(day: string) {
  return `oura:day:${day}`
}

export function calendarDayUtc(daysAgo: number, from = new Date()) {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - daysAgo))
  return date.toISOString().slice(0, 10)
}

export function normalizeOuraDay(documents: OuraDayDocuments) {
  const samples: { key: string; value: number }[] = []
  const documentIds: Record<string, string> = {}

  addScore(samples, documents.daily_readiness, "oura_readiness_score", "oura_readiness_", documentIds, "daily_readiness")
  addScore(samples, documents.daily_sleep, "oura_sleep_score", "oura_sleep_", documentIds, "daily_sleep")
  addScore(samples, documents.daily_activity, "oura_activity_score", "oura_activity_", documentIds, "daily_activity")

  const stress = documents.daily_stress
  if (stress) {
    if (stress.id) documentIds.daily_stress = stress.id
    addNumber(samples, "oura_stress_high_seconds", stress.stress_high)
    addNumber(samples, "oura_recovery_high_seconds", stress.recovery_high)
    const summary = stress.day_summary ? STRESS_SUMMARY[stress.day_summary] : undefined
    if (summary !== undefined) samples.push({ key: "oura_stress_summary", value: summary })
  }

  return { samples, documentIds }
}

export async function ingestOuraDay(input: {
  workspaceId: string
  personId: string
  day: string
  documents: OuraDayDocuments
  definitions?: Map<string, string>
  fireRules?: boolean
}) {
  const { db } = await import("@life-os/db")
  const { samples, documentIds } = normalizeOuraDay(input.documents)
  const definitions = input.definitions ?? await ensureOuraMetricDefinitions(input.workspaceId, samples.map(sample => sample.key))

  const result = await withSqliteBusyRetry(() => db.$transaction(
    tx => recordHealthDailyDigestInTransaction(tx, definitions, {
      workspaceId: input.workspaceId,
      personId: input.personId,
      day: input.day,
      samples,
      source: OURA_SOURCE,
      marker: ouraDayMarker(input.day),
      contentLabel: OURA_CONTENT_LABEL,
      metadataExtra: { source: OURA_SOURCE, documentIds },
      actor: ACTOR,
    }),
    HEALTH_DAILY_TRANSACTION,
  ))
  if (input.fireRules !== false) {
    await withSqliteBusyRetry(() => fireHealthDailyRules(result.states, ACTOR))
  }
  return { noteId: result.noteId, sampleCount: samples.length, documentIds }
}

export async function backfillOuraConnection(connection: OuraConnectionRow, days = OURA_BACKFILL_DAYS) {
  const end = calendarDayUtc(0)
  const start = calendarDayUtc(days - 1)
  const accessToken = await accessTokenFor(connection)
  const byDay = new Map<string, OuraDayDocuments>()
  let stressUnavailable = false

  for (const collection of OURA_DAILY_COLLECTIONS) {
    try {
      const documents = await fetchOuraCollection(accessToken, collection, start, end)
      for (const document of documents) {
        const day = document.day
        if (!day) continue
        const bucket = byDay.get(day) ?? {}
        bucket[collection] = document
        byDay.set(day, bucket)
      }
    } catch (error) {
      if (collection === "daily_stress" && error instanceof OuraError && error.code === "forbidden") {
        stressUnavailable = true
        continue
      }
      throw error
    }
  }

  const personId = await workspaceOwnerPersonId(connection.workspaceId)
  if (!personId) throw new OuraError("Workspace owner has no linked Person to record Oura States against", "validation")

  const keys = [...byDay.values()].flatMap(documents => normalizeOuraDay(documents).samples.map(sample => sample.key))
  const definitions = await ensureOuraMetricDefinitions(connection.workspaceId, keys)
  const alreadyImported = await importedOuraDays(connection.workspaceId)

  let daysWritten = 0
  let daysSkipped = 0
  // Newest first so a timeout still lands today/yesterday. Skip days that
  // already have an oura:day Note so a retried Sync only fills the gap.
  for (const [day, documents] of [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a))) {
    if (alreadyImported.has(day)) {
      daysSkipped += 1
      continue
    }
    await ingestOuraDay({
      workspaceId: connection.workspaceId,
      personId,
      day,
      documents,
      definitions,
      fireRules: false,
    })
    daysWritten += 1
  }

  await markConnectionSynced(connection.id, {
    backfillComplete: true,
    backfillStart: start,
    backfillEnd: end,
    daysWritten,
    daysSkipped,
    stressScope: stressUnavailable ? "unavailable" : "granted",
  })
  return { start, end, daysWritten, daysSkipped, stressUnavailable }
}

export async function ingestOuraWebhookDocument(connection: OuraConnectionRow, dataType: string, objectId: string) {
  if (!isDailyCollection(dataType)) return { skipped: true as const, reason: "unsupported_data_type" }
  const accessToken = await accessTokenFor(connection)
  const changed = await fetchOuraDocument(accessToken, dataType, objectId)
  const day = changed.day
  if (!day) return { skipped: true as const, reason: "missing_day" }

  const personId = await workspaceOwnerPersonId(connection.workspaceId)
  if (!personId) throw new OuraError("Workspace owner has no linked Person to record Oura States against", "validation")

  // Re-fetch the whole calendar day so replacing source=oura States does not
  // drop the other Oura documents that already landed for that day.
  const documents = await fetchOuraDay(accessToken, day)
  documents[dataType] = changed
  const written = await ingestOuraDay({ workspaceId: connection.workspaceId, personId, day, documents })
  await markConnectionSynced(connection.id, { lastWebhookDay: day, lastWebhookDataType: dataType })
  return { skipped: false as const, day, ...written }
}

async function fetchOuraDay(accessToken: string, day: string): Promise<OuraDayDocuments> {
  const documents: OuraDayDocuments = {}
  for (const collection of OURA_DAILY_COLLECTIONS) {
    try {
      const rows = await fetchOuraCollection(accessToken, collection, day, day)
      if (rows[0]) documents[collection] = rows[0]
    } catch (error) {
      if (collection === "daily_stress" && error instanceof OuraError && error.code === "forbidden") continue
      throw error
    }
  }
  return documents
}

export async function ensureOuraWebhookSubscriptions() {
  const existing = await listOuraWebhookSubscriptions().catch(() => [])
  const have = new Set(existing.map(row => `${row.data_type}:${row.event_type}`))
  const created: string[] = []
  for (const dataType of WEBHOOK_DATA_TYPES) {
    for (const eventType of ["create", "update"] as const) {
      const key = `${dataType}:${eventType}`
      if (have.has(key)) continue
      await createOuraWebhookSubscription(dataType, eventType)
      created.push(key)
    }
  }
  return { created, existing: [...have] }
}

export async function persistOuraTokens(
  connectionId: string,
  tokens: OuraTokenResponse,
  extra?: { scope?: string | null; lastError?: string | null; metadata?: Record<string, unknown> },
) {
  const { db } = await import("@life-os/db")
  const expiresAt = new Date(Date.now() + Math.max(0, (tokens.expires_in ?? 0) * 1000))
  const existing = extra?.metadata ? null : await db.connection.findUnique({ where: { id: connectionId }, select: { metadata: true } })
  const metadata = extra?.metadata ?? parseMetadata(existing?.metadata ?? null)
  await withSqliteBusyRetry(() => db.connection.update({
    where: { id: connectionId },
    data: {
      status: "active",
      accessTokenEncrypted: encryptNullable(tokens.access_token),
      refreshTokenEncrypted: encryptNullable(tokens.refresh_token),
      expiresAt,
      ...(extra?.scope !== undefined ? { scope: extra.scope } : {}),
      lastError: extra?.lastError ?? null,
      metadata: JSON.stringify(metadata),
    },
  }))
}

export async function disconnectOuraConnection(connection: OuraConnectionRow) {
  const { db } = await import("@life-os/db")
  const accessToken = decryptNullable(connection.accessTokenEncrypted)
  if (accessToken) await revokeOuraToken(accessToken).catch(() => undefined)
  await db.connection.update({
    where: { id: connection.id },
    data: {
      status: "disabled",
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      expiresAt: null,
      lastError: null,
    },
  })
}

async function accessTokenFor(connection: OuraConnectionRow) {
  const { db } = await import("@life-os/db")
  const access = decryptNullable(connection.accessTokenEncrypted)
  const refresh = decryptNullable(connection.refreshTokenEncrypted)
  if (!access || !refresh) throw new OuraError("Oura connection has no stored tokens", "revoked")
  const expiring = !connection.expiresAt || connection.expiresAt.getTime() < Date.now() + 60_000
  if (!expiring) return access

  try {
    const tokens = await refreshOuraTokens(refresh)
    await persistOuraTokens(connection.id, tokens)
    connection.accessTokenEncrypted = encryptNullable(tokens.access_token)
    connection.refreshTokenEncrypted = encryptNullable(tokens.refresh_token)
    connection.expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
    return tokens.access_token
  } catch (error) {
    const code = error instanceof OuraError && error.code === "revoked" ? "revoked" : "refresh_failed"
    await db.connection.update({
      where: { id: connection.id },
      data: { status: code === "revoked" ? "disabled" : "active", lastError: code },
    })
    throw error
  }
}

async function markConnectionSynced(connectionId: string, patch: Record<string, unknown>) {
  const { db } = await import("@life-os/db")
  const row = await db.connection.findUnique({ where: { id: connectionId }, select: { metadata: true } })
  const metadata = { ...parseMetadata(row?.metadata ?? null), ...patch }
  await withSqliteBusyRetry(() => db.connection.update({
    where: { id: connectionId },
    data: { lastSyncedAt: new Date(), lastError: null, status: "active", metadata: JSON.stringify(metadata) },
  }))
}

export async function workspaceOwnerPersonId(workspaceId: string) {
  const { db } = await import("@life-os/db")
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerUserId: true, members: { where: { status: "active" }, orderBy: { createdAt: "asc" }, take: 1, select: { userId: true } } },
  })
  const userId = workspace?.ownerUserId ?? workspace?.members[0]?.userId
  return userId ? (await db.user.findUnique({ where: { id: userId }, select: { personId: true } }))?.personId ?? null : null
}

function addScore(
  samples: { key: string; value: number }[],
  document: OuraDailyDocument | null | undefined,
  scoreKey: string,
  contributorPrefix: string,
  documentIds: Record<string, string>,
  collection: string,
) {
  if (!document) return
  if (document.id) documentIds[collection] = document.id
  addNumber(samples, scoreKey, document.score)
  for (const [name, value] of Object.entries(document.contributors ?? {})) {
    addNumber(samples, `${contributorPrefix}${name}`, value)
  }
}

function addNumber(samples: { key: string; value: number }[], key: string, value: number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) samples.push({ key, value })
}

function isDailyCollection(value: string): value is OuraDailyCollection {
  return (OURA_DAILY_COLLECTIONS as readonly string[]).includes(value)
}

function parseMetadata(value: string | null) {
  try { return JSON.parse(value ?? "{}") as Record<string, unknown> } catch { return {} }
}

export function importedOuraDaysFromNotes(notes: { metadata: string | null }[]) {
  const days = new Set<string>()
  for (const note of notes) {
    const marker = parseMetadata(note.metadata).sourceMarker
    if (typeof marker === "string" && marker.startsWith("oura:day:")) days.add(marker.slice("oura:day:".length))
  }
  return days
}

async function importedOuraDays(workspaceId: string) {
  const { db } = await import("@life-os/db")
  const notes = await db.note.findMany({
    where: { workspaceId, type: "import", metadata: { contains: "oura:day:" } },
    select: { metadata: true },
  })
  return importedOuraDaysFromNotes(notes)
}

async function ensureOuraMetricDefinitions(workspaceId: string, keys: Iterable<string>) {
  const definitions = new Map<string, string>()
  for (const key of new Set(keys)) {
    const definition = await withSqliteBusyRetry(() => ensureStateDefinition(
      { entityType: "Person", type: "health_metric", value: key, description: OURA_METRIC_TAXONOMY[key] ?? null },
      workspaceId,
    ))
    definitions.set(key, definition.id)
  }
  return definitions
}

export function isSqliteBusy(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /SQLITE_BUSY|database is locked|P2034|P1008/i.test(`${code} ${message}`)
}

async function withSqliteBusyRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      last = error
      if (!isSqliteBusy(error) || attempt === attempts - 1) throw error
      await new Promise(resolve => setTimeout(resolve, 80 * 2 ** attempt + Math.floor(Math.random() * 40)))
    }
  }
  throw last
}
