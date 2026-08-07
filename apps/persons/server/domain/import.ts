import JSZip from "jszip"
import type { StagedVisitStatus } from "@life-os/db"
import { db } from "@/lib/db"
import { badRequest, notFound } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import { createReviewItem, syncReviewItemStatus, registerReviewCommand, registerReviewDismiss } from "@life-os/domain"

export type MapsImportFormat = "legacy_takeout" | "device_timeline" | "unknown"
export type StagedVisitAction = "accept" | "reject" | "skip"

export type RawVisit = {
  raw: unknown
  format: Exclude<MapsImportFormat, "unknown">
  placeName?: string
  placeAddress?: string
  latitude?: number
  longitude?: number
  googlePlaceId?: string
  startedAt: Date
  endedAt?: Date
  visitConfidence?: number
  locationConfidence?: number
  placeConfidence?: string
  userActivityType?: string
  probability?: number
}

type ImportJobRow = Awaited<ReturnType<typeof getImportJob>>
type ImportCounters = {
  processedRows: number
  createdRows: number
  stagedRows: number
  skippedRows: number
  errorRows: number
}

const AUTO_CREATE_THRESHOLD = 70
const STAGE_THRESHOLD = 30
const MAX_AUTO_CREATED_EVENTS = 10_000
const BATCH_SIZE = 100
const BATCH_DELAY_MS = 100

export function detectFormat(json: unknown): MapsImportFormat {
  if (isRecord(json) && Array.isArray(json.timelineObjects)) return "legacy_takeout"
  if (isRecord(json) && Array.isArray(json.semanticSegments)) return "device_timeline"
  return "unknown"
}

export async function parseFile(buffer: Buffer, format?: MapsImportFormat): Promise<RawVisit[]> {
  const bytes = buffer.subarray(0, 4)
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (isZip) return parseZip(buffer)

  const json = JSON.parse(buffer.toString("utf8")) as unknown
  const detected = format && format !== "unknown" ? format : detectFormat(json)
  if (detected === "unknown") throw badRequest("Unsupported Google Maps export format")
  return parseJsonDocument(json, detected)
}

export function normalizeConfidence(visit: RawVisit): number {
  let score = 0

  if (visit.format === "legacy_takeout") {
    const base = visit.placeConfidence === "HIGH_CONFIDENCE"
      ? 90
      : visit.placeConfidence === "MEDIUM_CONFIDENCE"
        ? 60
        : visit.placeConfidence === "LOW_CONFIDENCE"
          ? 30
          : visit.locationConfidence ?? 50
    score = typeof visit.visitConfidence === "number" ? (base + visit.visitConfidence) / 2 : base
    if (visit.userActivityType === "WALKING") score += 5
  } else {
    score = (visit.probability ?? visit.visitConfidence ?? 0) * 100
  }

  const minutes = durationMinutes(visit)
  if (minutes !== null && minutes < 5) score /= 2
  if (minutes !== null && minutes > 24 * 60) score = Math.min(score, 50)
  if (visit.userActivityType === "WALKING" && score >= 60) score = Math.max(score, AUTO_CREATE_THRESHOLD)

  return Math.max(0, Math.min(100, Math.round(score * 10) / 10))
}

export async function createImportJob(input: {
  workspaceId: string
  filename: string
  buffer: Buffer
  actor?: DomainActor
}) {
  const parsed = await parseFile(input.buffer)
  if (parsed.length === 0) throw badRequest("No place visits found in this export")
  const format = parsed[0].format

  const job = await db.importJob.create({
    data: {
      workspaceId: input.workspaceId,
      format,
      filename: input.filename,
      rawData: input.buffer.toString("base64"),
      totalRows: parsed.length,
    },
  })

  await auditAction({
    actor: input.actor,
    action: "places.import.create",
    targetType: "importJob",
    targetId: job.id,
    metadata: { filename: input.filename, format, totalRows: parsed.length },
  })

  await processImportJob(job.id, input.workspaceId, { parsed, actor: input.actor })
  return getImportJob(job.id, input.workspaceId)
}

export async function getImportJob(jobId: string, workspaceId: string) {
  const job = await db.importJob.findFirst({
    where: { id: jobId, workspaceId },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      format: true,
      filename: true,
      totalRows: true,
      processedRows: true,
      createdRows: true,
      stagedRows: true,
      skippedRows: true,
      errorRows: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
    },
  })
  if (!job) throw notFound("Import job not found", { jobId })
  return job
}

export async function listStagedVisits(jobId: string, workspaceId: string, opts: { page?: number; pageSize?: number; status?: string } = {}) {
  await assertImportJob(jobId, workspaceId)
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25))
  const status = stagedVisitStatus(opts.status)
  const where = {
    importJobId: jobId,
    workspaceId,
    ...(status ? { status } : {}),
  }
  const [items, total] = await Promise.all([
    db.importStagedVisit.findMany({
      where,
      orderBy: [{ confidence: "desc" }, { startedAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.importStagedVisit.count({ where }),
  ])
  return { items, total, page, pageSize, hasMore: page * pageSize < total }
}

export async function updateStagedVisit(jobId: string, visitId: string, workspaceId: string, action: StagedVisitAction, actor?: DomainActor) {
  await assertImportJob(jobId, workspaceId)
  const visit = await db.importStagedVisit.findFirst({ where: { id: visitId, importJobId: jobId, workspaceId } })
  if (!visit) throw notFound("Staged visit not found", { visitId })
  if (visit.status !== "pending") return visit
  if (action === "skip") return visit
  if (action === "reject") {
    const rejected = await db.importStagedVisit.update({ where: { id: visit.id }, data: { status: "rejected" } })
    await auditAction({ actor, action: "places.import.visit.reject", targetType: "importStagedVisit", targetId: visit.id })
    await syncReviewItemStatus({ source: "import_staged_visit", sourceId: visit.id, workspaceId, status: "dismissed", actor })
    return rejected
  }

  const { place, event, skipped } = await acceptVisit(stagedVisitToRawVisit(visit), workspaceId)
  const accepted = await db.importStagedVisit.update({
    where: { id: visit.id },
    data: {
      status: "accepted",
      resolvedPlaceId: place.id,
      resolvedEventId: event?.id ?? null,
    },
  })
  if (!skipped) {
    await db.importJob.update({ where: { id: jobId }, data: { createdRows: { increment: 1 } } })
  }
  await auditAction({ actor, action: "places.import.visit.accept", targetType: "importStagedVisit", targetId: visit.id, metadata: { placeId: place.id, eventId: event?.id ?? null, skipped } })
  await syncReviewItemStatus({
    source: "import_staged_visit",
    sourceId: visit.id,
    workspaceId,
    status: "accepted",
    resultType: event ? "Event" : "Place",
    resultId: event?.id ?? place.id,
    actor,
  })
  return accepted
}

export async function bulkUpdateStagedVisits(jobId: string, workspaceId: string, input: { action: StagedVisitAction; minConfidence?: number; visitIds?: string[] }, actor?: DomainActor) {
  await assertImportJob(jobId, workspaceId)
  if (input.action === "skip") return { updated: 0 }

  const visits = await db.importStagedVisit.findMany({
    where: {
      importJobId: jobId,
      workspaceId,
      status: "pending",
      ...(input.visitIds?.length ? { id: { in: input.visitIds } } : {}),
      ...(typeof input.minConfidence === "number" ? { confidence: { gte: input.minConfidence } } : {}),
    },
    take: 500,
    orderBy: { confidence: "desc" },
  })

  if (input.action === "reject") {
    await db.importStagedVisit.updateMany({ where: { id: { in: visits.map(visit => visit.id) } }, data: { status: "rejected" } })
    await auditAction({ actor, action: "places.import.visit.reject_bulk", targetType: "importJob", targetId: jobId, metadata: { count: visits.length } })
    for (const visit of visits) {
      await syncReviewItemStatus({ source: "import_staged_visit", sourceId: visit.id, workspaceId, status: "dismissed", actor })
    }
    return { updated: visits.length }
  }

  let updated = 0
  for (const visit of visits) {
    await updateStagedVisit(jobId, visit.id, workspaceId, "accept", actor)
    updated += 1
  }
  return { updated }
}

export async function processImportJob(jobId: string, workspaceId: string, opts: { parsed?: RawVisit[]; actor?: DomainActor } = {}) {
  const job = await db.importJob.findFirst({ where: { id: jobId, workspaceId } })
  if (!job) throw notFound("Import job not found", { jobId })

  await db.importJob.update({ where: { id: jobId }, data: { status: "running", startedAt: new Date() } })
  const counters: ImportCounters = { processedRows: 0, createdRows: 0, stagedRows: 0, skippedRows: 0, errorRows: 0 }

  try {
    const visits = opts.parsed ?? await parseFile(Buffer.from(job.rawData ?? "", "base64"), job.format as MapsImportFormat)
    for (let index = 0; index < visits.length; index += 1) {
      const visit = visits[index]
      counters.processedRows += 1
      try {
        if (visit.startedAt > new Date()) {
          counters.skippedRows += 1
        } else {
          const confidence = normalizeConfidence(visit)
          const shouldStageUnnamed = !visit.placeName && !hasCoordinates(visit)
          if (confidence >= AUTO_CREATE_THRESHOLD && !shouldStageUnnamed && counters.createdRows < MAX_AUTO_CREATED_EVENTS) {
            const result = await acceptVisit(visit, workspaceId)
            counters[result.skipped ? "skippedRows" : "createdRows"] += 1
          } else if (confidence >= STAGE_THRESHOLD) {
            await stageVisit(jobId, workspaceId, visit, confidence)
            counters.stagedRows += 1
          } else {
            counters.skippedRows += 1
          }
        }
      } catch (error) {
        counters.errorRows += 1
        console.error("[places import] visit failed", error)
      }

      if (counters.processedRows % BATCH_SIZE === 0) {
        await persistCounters(jobId, counters)
        await delay(BATCH_DELAY_MS)
      }
    }

    await db.importJob.update({
      where: { id: jobId },
      data: { ...counters, status: "done", finishedAt: new Date() },
    })
    await auditAction({ actor: opts.actor, action: "places.import.finish", targetType: "importJob", targetId: jobId, metadata: counters })
  } catch (error) {
    await db.importJob.update({ where: { id: jobId }, data: { ...counters, status: "failed", finishedAt: new Date() } })
    throw error
  }
}

async function parseZip(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const visits: RawVisit[] = []
  const entries = Object.values(zip.files).filter(file => !file.dir && file.name.endsWith(".json"))
  for (const entry of entries) {
    const text = await entry.async("text")
    const json = JSON.parse(text) as unknown
    const format = detectFormat(json)
    if (format !== "unknown") visits.push(...parseJsonDocument(json, format))
  }
  if (visits.length === 0) throw badRequest("No Google Maps Timeline JSON files found in this zip")
  return visits
}

function parseJsonDocument(json: unknown, format: Exclude<MapsImportFormat, "unknown">) {
  return format === "legacy_takeout" ? parseLegacyTakeout(json) : parseDeviceTimeline(json)
}

function parseLegacyTakeout(json: unknown): RawVisit[] {
  if (!isRecord(json) || !Array.isArray(json.timelineObjects)) return []
  return json.timelineObjects.flatMap(item => {
    if (!isRecord(item) || !isRecord(item.placeVisit)) return []
    const visit = item.placeVisit
    const location = isRecord(visit.location) ? visit.location : {}
    const duration = isRecord(visit.duration) ? visit.duration : {}
    const start = dateFrom(duration.startTimestamp)
    if (!start) return []
    return [{
      raw: visit,
      format: "legacy_takeout" as const,
      placeName: stringFrom(location.name),
      placeAddress: stringFrom(location.address),
      latitude: e7ToDecimal(location.latitudeE7),
      longitude: e7ToDecimal(location.longitudeE7),
      googlePlaceId: stringFrom(location.placeId),
      startedAt: start,
      endedAt: dateFrom(duration.endTimestamp) ?? undefined,
      visitConfidence: numberFrom(visit.visitConfidence),
      locationConfidence: numberFrom(location.locationConfidence),
      placeConfidence: stringFrom(visit.placeConfidence),
      userActivityType: stringFrom(visit.userActivityType),
    }]
  })
}

function parseDeviceTimeline(json: unknown): RawVisit[] {
  if (!isRecord(json) || !Array.isArray(json.semanticSegments)) return []
  return json.semanticSegments.flatMap(segment => {
    if (!isRecord(segment) || !isRecord(segment.visit)) return []
    const visit = segment.visit
    const topCandidate = isRecord(visit.topCandidate) ? visit.topCandidate : {}
    const start = dateFrom(segment.startTime)
    if (!start) return []
    return [{
      raw: segment,
      format: "device_timeline" as const,
      googlePlaceId: stringFrom(topCandidate.placeId),
      startedAt: start,
      endedAt: dateFrom(segment.endTime) ?? undefined,
      probability: numberFrom(topCandidate.probability) ?? numberFrom(visit.probability) ?? undefined,
    }]
  })
}

async function acceptVisit(visit: RawVisit, workspaceId: string) {
  const place = await upsertPlace(visit, workspaceId)
  const existingEvent = await findDuplicateEvent(place.id, visit.startedAt, workspaceId)
  if (existingEvent) return { place, event: existingEvent, skipped: true }

  const event = await db.event.create({
    data: {
      workspaceId,
      placeId: place.id,
      name: `Visit: ${place.name}`,
      type: "visit",
      start: visit.startedAt,
      end: visit.endedAt ?? null,
      timestamp: visit.startedAt,
      notes: visit.placeAddress ? `Imported from Google Maps Timeline. ${visit.placeAddress}` : "Imported from Google Maps Timeline.",
      metadata: JSON.stringify({
        source: "google_maps",
        googlePlaceId: visit.googlePlaceId ?? null,
        confidence: normalizeConfidence(visit),
        startedAt: visit.startedAt.toISOString(),
        endedAt: visit.endedAt?.toISOString() ?? null,
      }),
    },
  })
  return { place, event, skipped: false }
}

async function upsertPlace(visit: RawVisit, workspaceId: string) {
  if (visit.googlePlaceId) {
    const existing = await db.place.findFirst({ where: { workspaceId, googlePlaceId: visit.googlePlaceId } })
    if (existing) return existing
  }

  const nearby = await findNearbyPlace(visit, workspaceId)
  if (nearby) {
    return db.place.update({
      where: { id: nearby.id },
      data: {
        googlePlaceId: nearby.googlePlaceId ?? visit.googlePlaceId ?? undefined,
        address: nearby.address ?? visit.placeAddress ?? undefined,
      },
    })
  }

  return db.place.create({
    data: {
      workspaceId,
      name: visit.placeName || "Unnamed Google place",
      googlePlaceId: visit.googlePlaceId,
      type: "visited_place",
      address: visit.placeAddress,
      coordinates: hasCoordinates(visit) ? JSON.stringify({ latitude: visit.latitude, longitude: visit.longitude }) : undefined,
      meaning: visit.placeName ? undefined : "Imported from Google Maps Timeline without a name. Review and rename this place.",
    },
  })
}

async function stageVisit(jobId: string, workspaceId: string, visit: RawVisit, confidence: number) {
  const staged = await db.importStagedVisit.create({
    data: {
      importJobId: jobId,
      workspaceId,
      rawData: visit.raw as object,
      placeName: visit.placeName,
      placeAddress: visit.placeAddress,
      latitude: visit.latitude,
      longitude: visit.longitude,
      googlePlaceId: visit.googlePlaceId,
      startedAt: visit.startedAt,
      endedAt: visit.endedAt,
      confidence,
    },
    select: { id: true },
  })
  await createReviewItem({
    workspaceId,
    source: "import_staged_visit",
    sourceId: staged.id,
    itemType: "event",
    command: "import_staged_visit.accept",
    commandInput: { jobId, visitId: staged.id },
    targetType: "Place",
    confidence: Math.max(0, Math.min(1, confidence / 100)),
    riskTier: "review",
  })
}

async function findNearbyPlace(visit: RawVisit, workspaceId: string) {
  if (!visit.placeName || !hasCoordinates(visit)) return null
  const placeName = visit.placeName
  const latitude = visit.latitude
  const longitude = visit.longitude
  const places = await db.place.findMany({ where: { workspaceId }, take: 500 })
  return places.find(place => {
    const coords = coordinatesFromString(place.coordinates)
    if (!coords) return false
    return namesSimilar(place.name, placeName) && distanceMeters(coords.latitude, coords.longitude, latitude!, longitude!) <= 50
  }) ?? null
}

async function findDuplicateEvent(placeId: string, startedAt: Date, workspaceId: string) {
  const twoHours = 2 * 60 * 60 * 1000
  return db.event.findFirst({
    where: {
      workspaceId,
      placeId,
      timestamp: {
        gte: new Date(startedAt.getTime() - twoHours),
        lte: new Date(startedAt.getTime() + twoHours),
      },
    },
  })
}

function stagedVisitToRawVisit(visit: { rawData: unknown; placeName: string | null; placeAddress: string | null; latitude: number | null; longitude: number | null; googlePlaceId: string | null; startedAt: Date; endedAt: Date | null; confidence: number }): RawVisit {
  return {
    raw: visit.rawData,
    format: "legacy_takeout",
    placeName: visit.placeName ?? undefined,
    placeAddress: visit.placeAddress ?? undefined,
    latitude: visit.latitude ?? undefined,
    longitude: visit.longitude ?? undefined,
    googlePlaceId: visit.googlePlaceId ?? undefined,
    startedAt: visit.startedAt,
    endedAt: visit.endedAt ?? undefined,
    visitConfidence: visit.confidence,
    placeConfidence: "MEDIUM_CONFIDENCE",
  }
}

async function persistCounters(jobId: string, counters: ImportCounters) {
  await db.importJob.update({ where: { id: jobId }, data: counters })
}

async function assertImportJob(jobId: string, workspaceId: string): Promise<ImportJobRow> {
  return getImportJob(jobId, workspaceId)
}

function durationMinutes(visit: RawVisit) {
  if (!visit.endedAt) return null
  return (visit.endedAt.getTime() - visit.startedAt.getTime()) / 60_000
}

function hasCoordinates(visit: RawVisit) {
  return typeof visit.latitude === "number" && typeof visit.longitude === "number"
}

function coordinatesFromString(raw: string | null) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const latitude = numberFrom(parsed.latitude ?? parsed.lat)
    const longitude = numberFrom(parsed.longitude ?? parsed.lng ?? parsed.lon)
    return latitude === undefined || longitude === undefined ? null : { latitude, longitude }
  } catch {
    return null
  }
}

function namesSimilar(a: string, b: string) {
  return normalizeName(a) === normalizeName(b)
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6_371_000
  const toRad = (value: number) => value * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function e7ToDecimal(value: unknown) {
  const n = numberFrom(value)
  return n === undefined ? undefined : n / 10_000_000
}

function dateFrom(value: unknown) {
  const text = stringFrom(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function stagedVisitStatus(value: string | undefined): StagedVisitStatus | null {
  return value === "pending" || value === "accepted" || value === "rejected" ? value : null
}

// Registered so ReviewItem's generic resolveReviewItem can accept an
// import_staged_visit from within this app (e.g. a future unified inbox
// route in apps/persons). Cross-app resolution from apps/api will not find
// this handler — this module only loads inside apps/persons' own process —
// so a /v1/review-items resolve call for this source needs to keep going
// through Persons' own /api/import/[jobId]/staged/[visitId] route, which
// already calls updateStagedVisit and syncs the ReviewItem alongside it.
registerReviewCommand("import_staged_visit.accept", async (input, ctx) => {
  const jobId = input.jobId as string
  const visitId = input.visitId as string
  const result = await updateStagedVisit(jobId, visitId, ctx.workspaceId, "accept")
  return { resultType: result.resolvedEventId ? "Event" : "Place", resultId: result.resolvedEventId ?? result.resolvedPlaceId }
})

registerReviewDismiss("import_staged_visit", async (visitId, ctx) => {
  const visit = await db.importStagedVisit.findFirst({ where: { id: visitId, workspaceId: ctx.workspaceId }, select: { importJobId: true } })
  if (!visit) return
  await updateStagedVisit(visit.importJobId, visitId, ctx.workspaceId, "reject")
})
