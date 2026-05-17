import Anthropic from "@anthropic-ai/sdk"
import { Prisma } from "@life-os/db"
import { db } from "@/lib/db"
import { notFound } from "@/server/api/errors"

export type EnrichmentContext = {
  coordinates: { lat: number; lng: number }
  address?: string
  visitedAt?: Date
  nearbyPlaces?: Array<{
    name: string
    category?: string
    distanceMeters: number
  }>
  financialTransactions?: Array<{ merchant: string; amount: number; timestamp: Date }>
  calendarEvents?: Array<{ title: string; start: Date; end: Date }>
}

export type EnrichmentResult = {
  placeName: string
  category: string
  confidence: number
  reasoning: string
}

const ENRICHMENT_BATCH_SIZE = 10
const ENRICHMENT_BATCH_DELAY_MS = 1000
const DEFAULT_MODEL = "claude-haiku-4-5-20251001"
const FALLBACK_MODEL = "claude-sonnet-4-6"

let anthropicClient: Anthropic | null = null

export async function enrichVisit(stagedVisitId: string): Promise<void> {
  const visit = await db.importStagedVisit.findUnique({ where: { id: stagedVisitId } })
  if (!visit) throw notFound("Staged visit not found", { stagedVisitId })
  if (visit.resolvedPlaceId || visit.aiEnrichment || visit.latitude === null || visit.longitude === null) return

  const context: EnrichmentContext = {
    coordinates: { lat: visit.latitude, lng: visit.longitude },
    address: visit.placeAddress ?? undefined,
    visitedAt: visit.startedAt,
    nearbyPlaces: await nearbyPlaces(visit.workspaceId, visit.latitude, visit.longitude),
  }

  const result = await callClaudeForEnrichment(context)
  if (!result) return

  await db.importStagedVisit.update({
    where: { id: visit.id },
    data: { aiEnrichment: result },
  })
}

export async function enrichPendingVisits(workspaceId: string, limit = 50) {
  const visits = await db.importStagedVisit.findMany({
    where: {
      workspaceId,
      status: "pending",
      resolvedPlaceId: null,
      aiEnrichment: { equals: Prisma.DbNull },
      latitude: { not: null },
      longitude: { not: null },
    },
    select: { id: true },
    orderBy: { startedAt: "desc" },
    take: limit,
  })

  let enriched = 0
  let skipped = 0
  for (let index = 0; index < visits.length; index += ENRICHMENT_BATCH_SIZE) {
    const batch = visits.slice(index, index + ENRICHMENT_BATCH_SIZE)
    const results = await Promise.all(batch.map(async visit => {
      try {
        await enrichVisit(visit.id)
        return "enriched" as const
      } catch (error) {
        console.error("[places enrichment] staged visit failed", { visitId: visit.id, error })
        return "skipped" as const
      }
    }))
    enriched += results.filter(result => result === "enriched").length
    skipped += results.filter(result => result === "skipped").length
    if (index + ENRICHMENT_BATCH_SIZE < visits.length) await delay(ENRICHMENT_BATCH_DELAY_MS)
  }

  return { processed: visits.length, enriched, skipped }
}

async function callClaudeForEnrichment(context: EnrichmentContext): Promise<EnrichmentResult | null> {
  const model = process.env.ENRICHMENT_MODEL || DEFAULT_MODEL
  try {
    return await callClaudeModel(model, context)
  } catch (error) {
    if (process.env.ENRICHMENT_MODEL || model === FALLBACK_MODEL) {
      console.error("[places enrichment] Claude enrichment failed", error)
      return null
    }
    console.warn("[places enrichment] default model failed; trying fallback", error)
    try {
      return await callClaudeModel(FALLBACK_MODEL, context)
    } catch (fallbackError) {
      console.error("[places enrichment] fallback Claude enrichment failed", fallbackError)
      return null
    }
  }
}

async function callClaudeModel(model: string, context: EnrichmentContext): Promise<EnrichmentResult | null> {
  const message = await getAnthropicClient().messages.create({
    model,
    max_tokens: 350,
    system: "You identify likely real-world places from sparse location-history context. Return only valid JSON.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: "Guess the most likely place identity for this unresolved visit.",
        context: {
          ...context,
          visitedAt: context.visitedAt?.toISOString(),
          financialTransactions: context.financialTransactions?.map(transaction => ({
            ...transaction,
            timestamp: transaction.timestamp.toISOString(),
          })),
          calendarEvents: context.calendarEvents?.map(event => ({
            ...event,
            start: event.start.toISOString(),
            end: event.end.toISOString(),
          })),
        },
        responseShape: {
          placeName: "string",
          category: "string such as coffee_shop, bank, restaurant, gym, home, office, unknown",
          confidence: "number from 0 to 1",
          reasoning: "short human-readable string",
        },
      }),
    }],
  })

  return parseEnrichmentResult(message.content
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("\n"))
}

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("Claude API location enrichment requires ANTHROPIC_API_KEY")
  anthropicClient ??= new Anthropic({ apiKey })
  return anthropicClient
}

async function nearbyPlaces(workspaceId: string, latitude: number, longitude: number) {
  const places = await db.place.findMany({
    where: { workspaceId },
    select: { name: true, type: true, coordinates: true },
    take: 1000,
  })

  return places.flatMap(place => {
    const coords = coordinatesFromString(place.coordinates)
    if (!coords) return []
    const meters = distanceMeters(latitude, longitude, coords.latitude, coords.longitude)
    if (meters > 200) return []
    return [{ name: place.name, category: place.type ?? undefined, distanceMeters: Math.round(meters) }]
  }).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 10)
}

function parseEnrichmentResult(text: string): EnrichmentResult | null {
  try {
    const json = JSON.parse(stripJsonFence(text)) as unknown
    if (!isRecord(json)) return null
    const confidence = typeof json.confidence === "number" ? json.confidence : Number(json.confidence)
    if (!json.placeName || !json.category || !Number.isFinite(confidence)) return null
    return {
      placeName: String(json.placeName).slice(0, 120),
      category: String(json.category).slice(0, 80),
      confidence: Math.max(0, Math.min(1, confidence)),
      reasoning: typeof json.reasoning === "string" ? json.reasoning.slice(0, 280) : "",
    }
  } catch (error) {
    console.warn("[places enrichment] failed to parse Claude JSON", { error, text })
    return null
  }
}

function stripJsonFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
}

function coordinatesFromString(raw: string | null) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null
    const latitude = numberFrom(parsed.latitude) ?? numberFrom(parsed.lat)
    const longitude = numberFrom(parsed.longitude) ?? numberFrom(parsed.lng)
    return latitude === undefined || longitude === undefined ? null : { latitude, longitude }
  } catch {
    return null
  }
}

function distanceMeters(latA: number, lngA: number, latB: number, lngB: number) {
  const earthRadius = 6_371_000
  const toRadians = (value: number) => value * Math.PI / 180
  const dLat = toRadians(latB - latA)
  const dLng = toRadians(lngB - lngA)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLng / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
