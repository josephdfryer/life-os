import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"

export type FinanceLayerItem = {
  placeId: string
  transactionCount: number
  totalAmount: number
}

export type PhotoLayerItem = {
  placeId: string
  photoCount: number
  googlePhotosDeeplink: string
}

export type InteractionLayerItem = {
  placeId: string
  interactionCount: number
}

export type UnresolvedVisitMapItem = {
  id: string
  importJobId: string
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
    getFinanceLayerItems(workspaceId),
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
      importJobId: visit.importJobId,
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
    select: {
      placeId: true,
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
    }
    item.interactionCount += 1
    byPlace.set(placeId, item)
  }

  return [...byPlace.values()]
}

export async function getFinanceLayerItems(workspaceId: string): Promise<FinanceLayerItem[]> {
  // Two sources, merged per place:
  //  1. Accepted financial Interactions carrying placeId (canonical graph)
  //  2. Era-staged transactions whose placeMatch resolved a merchant place
  //     (pre-acceptance signal, joined to Places by googlePlaceId)
  // Derived on every request — never stored.
  const [interactions, places, staged] = await Promise.all([
    db.interaction.findMany({
      where: { workspaceId, type: "financial", placeId: { not: null }, amount: { not: null } },
      select: { placeId: true, amount: true },
    }),
    db.place.findMany({
      where: { workspaceId, googlePlaceId: { not: null } },
      select: { id: true, googlePlaceId: true },
    }),
    db.stagedInteraction.findMany({
      where: { workspaceId, source: "era", status: "pending" },
      select: { metadata: true },
    }),
  ])

  const placeIdByGoogleId = new Map(places.map(place => [place.googlePlaceId!, place.id]))
  const byPlace = new Map<string, FinanceLayerItem>()

  const add = (placeId: string, amount: number) => {
    const item = byPlace.get(placeId) ?? { placeId, transactionCount: 0, totalAmount: 0 }
    item.transactionCount += 1
    item.totalAmount = Math.round((item.totalAmount + amount) * 100) / 100
    byPlace.set(placeId, item)
  }

  for (const interaction of interactions) {
    add(interaction.placeId!, Math.abs(centsToDollars(interaction.amount) ?? 0))
  }

  for (const row of staged) {
    const meta = parseStagedMeta(row.metadata)
    const match = meta?.placeMatch
    if (!match?.merchantPlace?.googlePlaceId) continue
    if (!["auto", "adjudicated"].includes(match.band ?? "")) continue
    const placeId = placeIdByGoogleId.get(match.merchantPlace.googlePlaceId)
    if (!placeId) continue
    add(placeId, Number(meta?.amount ?? 0))
  }

  return [...byPlace.values()]
}

type StagedFinanceMeta = {
  amount?: number
  placeMatch?: {
    band?: string
    merchantPlace?: { name: string; googlePlaceId: string | null } | null
  }
}

function parseStagedMeta(value: string | null): StagedFinanceMeta | null {
  if (!value) return null
  try {
    return JSON.parse(value) as StagedFinanceMeta
  } catch {
    return null
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
