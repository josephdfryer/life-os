import { db } from "@/lib/db"

export type FinanceLayerItem = {
  placeId: string
  transactionCount: number
  totalAmount: number
  transactions: Array<{ merchant: string; amount: number; date: string }>
}

export type PhotoLayerItem = {
  placeId: string
  photoCount: number
  googlePhotosDeeplink: string
}

export type InteractionLayerItem = {
  placeId: string
  interactionCount: number
  latestAt?: string
  people: Array<{ id: string; name: string }>
  interactions: Array<{
    id: string
    type: string
    summary?: string
    timestamp: string
    personName?: string
  }>
}

export type UnresolvedVisitMapItem = {
  id: string
  latitude: number
  longitude: number
  placeName?: string
  placeAddress?: string
  startedAt: string
  confidence: number
  aiEnrichment?: {
    placeName: string
    category: string
    confidence: number
    reasoning: string
  }
}

export async function getMapLayerData(workspaceId: string, placeIds: string[]) {
  const [unresolvedVisits, interactions, finance, photos] = await Promise.all([
    getUnresolvedVisitLayerItems(workspaceId),
    getInteractionLayerItems(workspaceId, placeIds),
    getFinanceLayerItems(),
    getPhotoLayerItems(),
  ])

  return { unresolvedVisits, interactions, finance, photos }
}

export async function getUnresolvedVisitLayerItems(workspaceId: string): Promise<UnresolvedVisitMapItem[]> {
  const visits = await db.importStagedVisit.findMany({
    where: {
      workspaceId,
      status: "pending",
      resolvedPlaceId: null,
      latitude: { not: null },
      longitude: { not: null },
    },
    orderBy: { startedAt: "desc" },
    take: 500,
  })

  return visits.flatMap(visit => {
    if (visit.latitude === null || visit.longitude === null) return []
    return [{
      id: visit.id,
      latitude: visit.latitude,
      longitude: visit.longitude,
      placeName: visit.placeName ?? undefined,
      placeAddress: visit.placeAddress ?? undefined,
      startedAt: visit.startedAt.toISOString(),
      confidence: visit.confidence,
      aiEnrichment: parseEnrichment(visit.aiEnrichment),
    }]
  })
}

export async function getInteractionLayerItems(workspaceId: string, placeIds: string[]): Promise<InteractionLayerItem[]> {
  if (!placeIds.length) return []

  const interactions = await db.interaction.findMany({
    where: {
      workspaceId,
      OR: [
        { placeId: { in: placeIds } },
        { event: { placeId: { in: placeIds } } },
      ],
    },
    include: {
      person: { select: { id: true, first: true, last: true } },
      event: { select: { placeId: true } },
    },
    orderBy: { timestamp: "desc" },
    take: 1000,
  })

  const byPlace = new Map<string, InteractionLayerItem>()
  for (const interaction of interactions) {
    const placeId = interaction.placeId ?? interaction.event?.placeId
    if (!placeId) continue
    const item = byPlace.get(placeId) ?? {
      placeId,
      interactionCount: 0,
      latestAt: undefined,
      people: [],
      interactions: [],
    }
    item.interactionCount += 1
    item.latestAt ??= interaction.timestamp.toISOString()
    const personName = interaction.person ? personDisplayName(interaction.person) : undefined
    if (interaction.person && !item.people.some(person => person.id === interaction.personId)) {
      item.people.push({ id: interaction.person.id, name: personName ?? "Unknown" })
    }
    if (item.interactions.length < 3) {
      item.interactions.push({
        id: interaction.id,
        type: interaction.type,
        summary: interaction.summary ?? undefined,
        timestamp: interaction.timestamp.toISOString(),
        personName,
      })
    }
    byPlace.set(placeId, item)
  }

  return [...byPlace.values()]
}

export async function getFinanceLayerItems(): Promise<FinanceLayerItem[]> {
  return []
}

export async function getPhotoLayerItems(): Promise<PhotoLayerItem[]> {
  // Future integration: Google Photos API (`photoslibrary.googleapis.com`) via
  // `mediaItems:search`, scoped to a bounding box around each Place. Add
  // `https://www.googleapis.com/auth/photoslibrary.readonly` to Google OAuth in
  // apps/places/auth.ts and surface the access_token via jwt/session callbacks
  // before replacing this placeholder with a live data fetch.
  return []
}

function parseEnrichment(value: unknown): UnresolvedVisitMapItem["aiEnrichment"] {
  if (!isRecord(value)) return undefined
  const confidence = typeof value.confidence === "number" ? value.confidence : Number(value.confidence)
  if (!value.placeName || !value.category || !Number.isFinite(confidence)) return undefined
  return {
    placeName: String(value.placeName),
    category: String(value.category),
    confidence: Math.max(0, Math.min(1, confidence)),
    reasoning: typeof value.reasoning === "string" ? value.reasoning : "",
  }
}

function personDisplayName(person: { first: string | null; last: string | null }) {
  return [person.first, person.last].filter(Boolean).join(" ").trim() || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
