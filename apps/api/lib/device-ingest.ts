import { createHash } from "node:crypto"
import type { DeviceIngestItemInput } from "@life-os/contracts"
import { db } from "@life-os/db"
import { createReviewItem, publishGraphEvent } from "@life-os/domain"
import { HEALTH_METRIC_TAXONOMY, ensureHealthMetricDefinitions, recordHealthDailyDigestInTransaction, fireHealthDailyRules } from "./health-daily"

export type DeviceIngestResult = {
  sourceId: string
  status: "accepted" | "duplicate" | "retryable" | "rejected"
  resultType: string | null
  resultId: string | null
  errorCode: string | null
}

export async function ingestDeviceItem(item: DeviceIngestItemInput, workspaceId: string): Promise<DeviceIngestResult> {
  if (item.deviceId.length === 0) return rejected(item.sourceId, "invalid_device")
  const payloadHash = hashPayload(item)
  const existing = await db.deviceIngestItem.findUnique({
    where: { workspaceId_source_sourceId: { workspaceId, source: item.source, sourceId: item.sourceId } },
  })
  if (existing) {
    if (existing.payloadHash !== payloadHash) return rejected(item.sourceId, "source_id_conflict")
    await repairReviewIndex(existing.id, existing.resultType, existing.resultId, item, workspaceId)
    return { sourceId: item.sourceId, status: "duplicate", resultType: existing.resultType, resultId: existing.resultId, errorCode: null }
  }

  try {
    switch (item.record.type) {
      case "health.daily": return await ingestHealthDaily(item as ItemFor<"health.daily">, workspaceId, payloadHash)
      case "health.workout": return await ingestWorkout(item as ItemFor<"health.workout">, workspaceId, payloadHash)
      case "location.visit": return await ingestVisit(item as ItemFor<"location.visit">, workspaceId, payloadHash)
      case "communication.message": return await ingestCommunication(item as ItemFor<"communication.message">, workspaceId, payloadHash)
      case "voice.transcript": return await ingestNote(item, workspaceId, payloadHash, "voice_transcript", item.record.transcript)
      case "document.metadata": return await ingestNote(item, workspaceId, payloadHash, "import", item.record.extractedText ?? `Document captured: ${item.record.filename}`)
      case "photo.metadata": return await ingestNote(item, workspaceId, payloadHash, "observation", item.record.caption ?? `Photo metadata captured at ${item.record.capturedAt}`)
    }
  } catch (error) {
    if (isUniqueConflict(error)) {
      const raced = await db.deviceIngestItem.findUnique({
        where: { workspaceId_source_sourceId: { workspaceId, source: item.source, sourceId: item.sourceId } },
      })
      if (raced?.payloadHash === payloadHash) return { sourceId: item.sourceId, status: "duplicate", resultType: raced.resultType, resultId: raced.resultId, errorCode: null }
    }
    console.error("[device/ingest] retryable item failure", { source: item.source, recordType: item.record.type, error })
    return { sourceId: item.sourceId, status: "retryable", resultType: null, resultId: null, errorCode: "temporary_failure" }
  }
}

type RecordType = DeviceIngestItemInput["record"]["type"]
type ItemFor<T extends RecordType> = Omit<DeviceIngestItemInput, "record"> & { record: Extract<DeviceIngestItemInput["record"], { type: T }> }

async function ingestHealthDaily(item: ItemFor<"health.daily">, workspaceId: string, payloadHash: string): Promise<DeviceIngestResult> {
  const personId = await workspaceOwnerPersonId(workspaceId)
  if (!personId) return rejected(item.sourceId, "owner_person_missing")
  const unknown = item.record.metrics.find(metric => !(metric.key in HEALTH_METRIC_TAXONOMY))
  if (unknown) return rejected(item.sourceId, "unsupported_health_metric")

  const marker = `healthkit:${item.deviceId}:day:${item.record.day}`
  const actor = { type: "system" as const, id: item.deviceId, label: "life-os-companion" }
  const definitions = await ensureHealthMetricDefinitions(workspaceId, item.record.metrics.map(metric => metric.key))
  const { noteId, states } = await db.$transaction(async tx => {
    const result = await recordHealthDailyDigestInTransaction(tx, definitions, {
      workspaceId, personId, day: item.record.day,
      samples: item.record.metrics.map(metric => ({ key: metric.key, value: metric.value })),
      source: "healthkit", marker, contentLabel: "HealthKit daily digest",
      metadataExtra: { source: "healthkit", deviceId: item.deviceId },
      actor,
    })
    await tx.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "State", result.noteId) })
    return result
  })
  await fireHealthDailyRules(states, actor).catch(error => console.warn("[device/ingest] state rule dispatch failed", { sourceId: item.sourceId, error }))
  return accepted(item.sourceId, "State", states[0]?.state.id ?? null)
}

async function ingestWorkout(item: ItemFor<"health.workout">, workspaceId: string, payloadHash: string): Promise<DeviceIngestResult> {
  const actor = { type: "system" as const, id: item.deviceId, label: "life-os-companion" }
  const event = await db.$transaction(async tx => {
    const created = await tx.event.create({ data: {
      workspaceId, name: item.record.workoutType, type: "workout", start: new Date(item.record.startedAt),
      end: item.record.endedAt ? new Date(item.record.endedAt) : null, timestamp: new Date(item.record.startedAt),
      metadata: JSON.stringify({ source: "healthkit", sourceId: item.sourceId, deviceId: item.deviceId, durationSeconds: item.record.durationSeconds, energyKcal: item.record.energyKcal, distanceMeters: item.record.distanceMeters }),
    } })
    await publishGraphEvent(tx, { workspaceId, subjectType: "Event", subjectId: created.id, eventType: "event.create", actor, sourceConnector: "healthkit", idempotencyKey: `device:${item.deviceId}:${item.source}:${item.sourceId}`, payload: { type: "workout" }, provenance: { deviceId: item.deviceId, sourceId: item.sourceId } })
    await tx.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "Event", created.id) })
    return created
  })
  return accepted(item.sourceId, "Event", event.id)
}

async function ingestVisit(item: ItemFor<"location.visit">, workspaceId: string, payloadHash: string): Promise<DeviceIngestResult> {
  const visit = await db.$transaction(async tx => {
    const job = await tx.importJob.create({ data: { workspaceId, status: "done", format: "life-os-companion-visit-v1", filename: `device:${item.deviceId}`, totalRows: 1, processedRows: 1, stagedRows: 1, startedAt: new Date(), finishedAt: new Date() } })
    const staged = await tx.importStagedVisit.create({ data: {
      importJobId: job.id, workspaceId, rawData: { source: "location", sourceId: item.sourceId, deviceId: item.deviceId, horizontalAccuracyMeters: item.record.horizontalAccuracyMeters },
      placeName: item.record.placeName, latitude: item.record.latitude, longitude: item.record.longitude,
      startedAt: new Date(item.record.startedAt), endedAt: item.record.endedAt ? new Date(item.record.endedAt) : null,
      confidence: accuracyConfidence(item.record.horizontalAccuracyMeters),
    } })
    const receipt = await tx.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "ImportStagedVisit", staged.id) })
    return { staged, receipt }
  })
  await repairReviewIndex(visit.receipt.id, "ImportStagedVisit", visit.staged.id, item, workspaceId)
  return accepted(item.sourceId, "ImportStagedVisit", visit.staged.id)
}

async function ingestCommunication(item: ItemFor<"communication.message">, workspaceId: string, payloadHash: string): Promise<DeviceIngestResult> {
  const staged = await db.$transaction(async tx => {
    const created = await tx.stagedInteraction.create({ data: {
      workspaceId, source: item.source, sourceId: item.sourceId, itemType: "interaction", status: "pending",
      contactName: item.record.contactName, contactPhone: item.record.contactHandle, type: item.record.channel === "call" ? "call" : "message",
      timestamp: new Date(item.observedAt), summary: item.record.text?.slice(0, 2_000) ?? `${item.record.direction} ${item.record.channel}`,
      body: item.record.text, direction: item.record.direction, metadata: JSON.stringify({ deviceId: item.deviceId, durationSeconds: item.record.durationSeconds }),
    } })
    const receipt = await tx.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "StagedInteraction", created.id) })
    return { created, receipt }
  })
  await repairReviewIndex(staged.receipt.id, "StagedInteraction", staged.created.id, item, workspaceId)
  return accepted(item.sourceId, "StagedInteraction", staged.created.id)
}

async function ingestNote(item: DeviceIngestItemInput, workspaceId: string, payloadHash: string, type: string, content: string): Promise<DeviceIngestResult> {
  const note = await db.$transaction(async tx => {
    const created = await tx.note.create({ data: { workspaceId, type, timestamp: new Date(item.observedAt), content, metadata: JSON.stringify({ source: item.source, sourceId: item.sourceId, deviceId: item.deviceId, record: item.record }) } })
    await publishGraphEvent(tx, { workspaceId, subjectType: "Note", subjectId: created.id, eventType: "note.create", actor: { type: "system", id: item.deviceId, label: "life-os-companion" }, sourceConnector: item.source, idempotencyKey: `device:${item.deviceId}:${item.source}:${item.sourceId}`, payload: { type }, provenance: { deviceId: item.deviceId, sourceId: item.sourceId } })
    await tx.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "Note", created.id) })
    return created
  })
  return accepted(item.sourceId, "Note", note.id)
}

async function repairReviewIndex(receiptId: string, resultType: string | null, resultId: string | null, item: DeviceIngestItemInput, workspaceId: string) {
  if (!resultId || (resultType !== "StagedInteraction" && resultType !== "ImportStagedVisit")) return
  await createReviewItem({
    workspaceId, source: resultType === "StagedInteraction" ? "staged_interaction" : "import_staged_visit", sourceId: resultId,
    itemType: resultType === "StagedInteraction" ? "interaction" : "visit",
    command: resultType === "StagedInteraction" ? "staged_interaction.accept" : "import_staged_visit.review",
    commandInput: resultType === "StagedInteraction" ? { stagedInteractionId: resultId } : { stagedVisitId: resultId },
    evidence: { deviceIngestItemId: receiptId, source: item.source, sourceId: item.sourceId }, riskTier: "review", priority: 3,
  }).catch(error => console.warn("[device/ingest] review index repair failed", { resultType, error }))
}

function receiptData(item: DeviceIngestItemInput, workspaceId: string, payloadHash: string, resultType: string, resultId: string) {
  return { workspaceId, deviceId: item.deviceId, source: item.source, sourceId: item.sourceId, recordType: item.record.type, schemaVersion: item.schemaVersion, observedAt: new Date(item.observedAt), payloadHash, status: "accepted", resultType, resultId }
}

async function workspaceOwnerPersonId(workspaceId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { ownerUserId: true, members: { where: { status: "active" }, orderBy: { createdAt: "asc" }, take: 1, select: { userId: true } } } })
  const userId = workspace?.ownerUserId ?? workspace?.members[0]?.userId
  return userId ? (await db.user.findUnique({ where: { id: userId }, select: { personId: true } }))?.personId ?? null : null
}

function hashPayload(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex") }
function accuracyConfidence(meters: number) { return Math.max(0.1, Math.min(1, 1 - meters / 1_000)) }
function accepted(sourceId: string, resultType: string, resultId: string | null): DeviceIngestResult { return { sourceId, status: "accepted", resultType, resultId, errorCode: null } }
function rejected(sourceId: string, errorCode: string): DeviceIngestResult { return { sourceId, status: "rejected", resultType: null, resultId: null, errorCode } }
function isUniqueConflict(error: unknown) { return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002") }
