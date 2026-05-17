import JSZip from "jszip"
import type { StagedVisitStatus } from "@life-os/db"
import { db } from "@/lib/db"
import { badRequest, notFound } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"

export type MapsImportFormat = "legacy_takeout" | "device_timeline" | "timeline_records" | "unknown"
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
  semanticType?: string
}

type ImportJobRow = Awaited<ReturnType<typeof getImportJob>>
type ImportCounters = {
  processedRows: number
  createdRows: number
  stagedRows: number
  skippedRows: number
  errorRows: number
}

export type ImportPreview = {
  format: MapsImportFormat
  totalRecords: number
  totalVisits: number
  ignoredRecords: number
  firstStartedAt: string | null
  lastStartedAt: string | null
  uniqueGooglePlaceIds: number
  estimatedAutoCreateRows: number
  estimatedStagedRows: number
  estimatedSkippedRows: number
  averageVisitMinutes: number | null
  sourceRecordTypes: Record<string, number>
  topSemanticTypes: Array<{ label: string; count: number }>
  confidenceBuckets: {
    high: number
    medium: number
    low: number
  }
  sampleVisits: Array<{
    startedAt: string
    endedAt: string | null
    googlePlaceId: string | null
    semanticType: string | null
    latitude: number | null
    longitude: number | null
    confidence: number
  }>
}

const AUTO_CREATE_THRESHOLD = 70
const STAGE_THRESHOLD = 30
const MAX_AUTO_CREATED_EVENTS = 10_000
const BATCH_SIZE = 100
const BATCH_DELAY_MS = 100

export function detectFormat(json: unknown): MapsImportFormat {
  if (isRecord(json) && Array.isArray(json.timelineObjects)) return "legacy_takeout"
  if (isRecord(json) && Array.isArray(json.semanticSegments)) return "device_timeline"
  if (Array.isArray(json) && json.some(item => isRecord(item) && ("visit" in item || "activity" in item || "timelinePath" in item || "timelineMemory" in item))) return "timeline_records"
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

export async function previewFile(buffer: Buffer, format?: MapsImportFormat): Promise<ImportPreview> {
  const bytes = buffer.subarray(0, 4)
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (isZip) {
    const visits = await parseZip(buffer)
    return buildPreview(visits, visits[0]?.format ?? "unknown", {}, visits.length)
  }

  const json = JSON.parse(buffer.toString("utf8")) as unknown
  const detected = format && format !== "unknown" ? format : detectFormat(json)
  if (detected === "unknown") throw badRequest("Unsupported Google Maps export format")
  const visits = parseJsonDocument(json, detected)
  return buildPreview(visits, detected, sourceRecordTypes(json), sourceRecordCount(json))
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
  } else if (visit.format === "device_timeline") {
    score = (visit.probability ?? visit.visitConfidence ?? 0) * 100
  } else {
    const candidateScore = (visit.probability ?? 0) * 100
    const visitScore = (visit.visitConfidence ?? 0) * 100
    score = candidateScore && visitScore ? (candidateScore * 0.7) + (visitScore * 0.3) : candidateScore || visitScore || 0
    if (visit.semanticType && visit.semanticType !== "Unknown") score += 5
  }

  const minutes = durationMinutes(visit)
  if (minutes !== null && minutes < 5) score /= 2
  if (minutes !== null && minutes > 24 * 60) score = Math.min(score, 50)
  if (visit.userActivityType === "WALKING" && score >= 60) score = Math.max(score, AUTO_CREATE_THRESHOLD)
  if (!visit.placeName && !hasCoordinates(visit)) score = Math.min(score, 69)

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
          const requiresReview = !visit.placeName
          if (confidence >= AUTO_CREATE_THRESHOLD && !requiresReview && counters.createdRows < MAX_AUTO_CREATED_EVENTS) {
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
  if (format === "legacy_takeout") return parseLegacyTakeout(json)
  if (format === "device_timeline") return parseDeviceTimeline(json)
  return parseTimelineRecords(json)
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

function parseTimelineRecords(json: unknown): RawVisit[] {
  if (!Array.isArray(json)) return []
  return json.flatMap(item => {
    if (!isRecord(item) || !isRecord(item.visit)) return []
    const visit = item.visit
    const topCandidate = isRecord(visit.topCandidate) ? visit.topCandidate : {}
    const start = dateFrom(item.startTime)
    if (!start) return []
    const coords = coordinatesFromGeoUri(stringFrom(topCandidate.placeLocation))
    const semanticType = stringFrom(topCandidate.semanticType)
    return [{
      raw: item,
      format: "timeline_records" as const,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      googlePlaceId: stringFrom(topCandidate.placeID) ?? stringFrom(topCandidate.placeId),
      startedAt: start,
      endedAt: dateFrom(item.endTime) ?? undefined,
      visitConfidence: numberFrom(visit.probability),
      probability: numberFrom(topCandidate.probability),
      semanticType,
      placeName: semanticType && semanticType !== "Unknown" ? semanticType : undefined,
    }]
  })
}

function buildPreview(visits: RawVisit[], format: MapsImportFormat, recordTypes: Record<string, number>, totalRecords: number): ImportPreview {
  const sorted = [...visits].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  const semanticCounts = new Map<string, number>()
  const googlePlaceIds = new Set<string>()
  let totalMinutes = 0
  let durationCount = 0
  let estimatedAutoCreateRows = 0
  let estimatedStagedRows = 0
  let estimatedSkippedRows = 0
  const confidenceBuckets = { high: 0, medium: 0, low: 0 }

  for (const visit of visits) {
    if (visit.googlePlaceId) googlePlaceIds.add(visit.googlePlaceId)
    if (visit.semanticType) semanticCounts.set(visit.semanticType, (semanticCounts.get(visit.semanticType) ?? 0) + 1)

    const minutes = durationMinutes(visit)
    if (minutes !== null && Number.isFinite(minutes) && minutes >= 0) {
      totalMinutes += minutes
      durationCount += 1
    }

    const confidence = normalizeConfidence(visit)
    if (confidence >= AUTO_CREATE_THRESHOLD) confidenceBuckets.high += 1
    else if (confidence >= STAGE_THRESHOLD) confidenceBuckets.medium += 1
    else confidenceBuckets.low += 1

    const requiresReview = !visit.placeName
    if (visit.startedAt > new Date()) estimatedSkippedRows += 1
    else if (confidence >= AUTO_CREATE_THRESHOLD && !requiresReview) estimatedAutoCreateRows += 1
    else if (confidence >= STAGE_THRESHOLD) estimatedStagedRows += 1
    else estimatedSkippedRows += 1
  }

  return {
    format,
    totalRecords,
    totalVisits: visits.length,
    ignoredRecords: Math.max(0, totalRecords - visits.length),
    firstStartedAt: sorted[0]?.startedAt.toISOString() ?? null,
    lastStartedAt: sorted.at(-1)?.startedAt.toISOString() ?? null,
    uniqueGooglePlaceIds: googlePlaceIds.size,
    estimatedAutoCreateRows,
    estimatedStagedRows,
    estimatedSkippedRows,
    averageVisitMinutes: durationCount ? Math.round((totalMinutes / durationCount) * 10) / 10 : null,
    sourceRecordTypes: recordTypes,
    topSemanticTypes: [...semanticCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, count]) => ({ label, count })),
    confidenceBuckets,
    sampleVisits: sorted.slice(0, 5).map(visit => ({
      startedAt: visit.startedAt.toISOString(),
      endedAt: visit.endedAt?.toISOString() ?? null,
      googlePlaceId: visit.googlePlaceId ?? null,
      semanticType: visit.semanticType ?? null,
      latitude: visit.latitude ?? null,
      longitude: visit.longitude ?? null,
      confidence: normalizeConfidence(visit),
    })),
  }
}

function sourceRecordCount(json: unknown) {
  if (Array.isArray(json)) return json.length
  if (isRecord(json) && Array.isArray(json.timelineObjects)) return json.timelineObjects.length
  if (isRecord(json) && Array.isArray(json.semanticSegments)) return json.semanticSegments.length
  return 0
}

function sourceRecordTypes(json: unknown) {
  const counts: Record<string, number> = {}
  const bump = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1
  }

  if (Array.isArray(json)) {
    for (const item of json) {
      if (!isRecord(item)) {
        bump("unknown")
      } else if (isRecord(item.visit)) {
        bump("visit")
      } else if (isRecord(item.activity)) {
        bump("activity")
      } else if (Array.isArray(item.timelinePath)) {
        bump("timelinePath")
      } else if (isRecord(item.timelineMemory)) {
        bump("timelineMemory")
      } else {
        bump("other")
      }
    }
  } else if (isRecord(json) && Array.isArray(json.timelineObjects)) {
    for (const item of json.timelineObjects) {
      bump(isRecord(item) && isRecord(item.placeVisit) ? "placeVisit" : "other")
    }
  } else if (isRecord(json) && Array.isArray(json.semanticSegments)) {
    for (const item of json.semanticSegments) {
      bump(isRecord(item) && isRecord(item.visit) ? "visit" : "other")
    }
  }

  return counts
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
  await db.importStagedVisit.create({
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

function coordinatesFromGeoUri(raw: string | undefined) {
  if (!raw?.startsWith("geo:")) return null
  const [latRaw, lngRaw] = raw.slice(4).split(",")
  const latitude = numberFrom(latRaw)
  const longitude = numberFrom(lngRaw)
  return latitude === undefined || longitude === undefined ? null : { latitude, longitude }
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
