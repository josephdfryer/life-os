import { db } from "@life-os/db"
import { acceptStagedVisitById } from "../server/domain/import"

const WORKSPACE_ID = "default-workspace"
const HOME = {
  name: "Home",
  address: "451 Crestdale Ln, Las Vegas, NV 89144",
  latitude: 36.1772136,
  longitude: -115.3223031,
  type: "home",
}

type StagedVisitRow = Awaited<ReturnType<typeof loadPendingVisits>>[number]

async function main() {
  const execute = process.argv.includes("--execute")
  const before = await snapshot()
  const visits = await loadPendingVisits()
  const homeGooglePlaceId = homeGoogleId(visits)
  const homePlace = execute ? await ensureHomePlace(homeGooglePlaceId) : await findHomePlace(homeGooglePlaceId)

  const candidates = visits.filter(shouldPromote)
  const homeCandidates = visits.filter(isHomeSemanticVisit)
  const skippedResidential = candidates.filter(isResidentialNoise)
  const promotionCandidates = candidates.filter(visit => !isResidentialNoise(visit))
  const ordered = uniqueRows([...homeCandidates, ...promotionCandidates])

  const result = {
    dryRun: !execute,
    before,
    selected: {
      googleResolvedVisits: candidates.length,
      homeSemanticVisits: homeCandidates.length,
      residentialNoiseLeftPending: skippedResidential.length,
      visitsToAccept: ordered.length,
      uniqueGooglePlaceIdsToAccept: new Set(ordered.map(visit => visit.googlePlaceId).filter(Boolean)).size,
    },
    accepted: 0,
    linkedToExistingEvent: 0,
    errors: [] as Array<{ visitId: string; error: string }>,
    after: before,
    homePlaceId: homePlace?.id ?? null,
  }

  if (execute) {
    for (const visit of ordered) {
      try {
        const accepted = await acceptStagedVisitById(visit.id, WORKSPACE_ID, {
          placeOverride: isHomeSemanticVisit(visit)
            ? {
                placeName: HOME.name,
                placeAddress: HOME.address,
                latitude: HOME.latitude,
                longitude: HOME.longitude,
                googlePlaceId: homeGooglePlaceId ?? visit.googlePlaceId ?? undefined,
                placeType: HOME.type,
              }
            : undefined,
        })
        if (accepted.accepted) result.accepted += 1
        if (accepted.skipped) result.linkedToExistingEvent += 1
      } catch (error) {
        result.errors.push({ visitId: visit.id, error: error instanceof Error ? error.message : String(error) })
      }
    }
    result.after = await snapshot()
    result.homePlaceId = (await findHomePlace(homeGooglePlaceId))?.id ?? null
  }

  console.log(JSON.stringify(result, null, 2))
  await db.$disconnect()

  if (result.errors.length) {
    process.exitCode = 1
  }
}

async function snapshot() {
  const [placeCount, pendingStagedVisits, acceptedStagedVisits, duplicateGooglePlaceIds] = await Promise.all([
    db.place.count({ where: { workspaceId: WORKSPACE_ID } }),
    db.importStagedVisit.count({ where: { workspaceId: WORKSPACE_ID, status: "pending" } }),
    db.importStagedVisit.count({ where: { workspaceId: WORKSPACE_ID, status: "accepted" } }),
    duplicateGoogleIdCount(),
  ])
  return { placeCount, pendingStagedVisits, acceptedStagedVisits, duplicateGooglePlaceIds }
}

function duplicateGoogleIdCount() {
  return db.$queryRaw<Array<{ googlePlaceId: string; count: bigint }>>`
    SELECT googlePlaceId, COUNT(*) as count
    FROM Place
    WHERE googlePlaceId IS NOT NULL
    GROUP BY googlePlaceId
    HAVING COUNT(*) > 1
  `.then(rows => rows.length)
}

function loadPendingVisits() {
  return db.importStagedVisit.findMany({
    where: { workspaceId: WORKSPACE_ID, status: "pending" },
    select: {
      id: true,
      placeName: true,
      placeAddress: true,
      latitude: true,
      longitude: true,
      googlePlaceId: true,
      aiEnrichment: true,
      rawData: true,
      startedAt: true,
    },
    orderBy: { startedAt: "asc" },
  })
}

async function ensureHomePlace(googlePlaceId: string | null) {
  const existing = await findHomePlace(googlePlaceId)
  const data = {
    name: HOME.name,
    type: HOME.type,
    address: HOME.address,
    coordinates: JSON.stringify({ latitude: HOME.latitude, longitude: HOME.longitude }),
    ...(googlePlaceId ? { googlePlaceId } : {}),
  }

  if (existing) {
    return db.place.update({
      where: { id: existing.id },
      data,
    })
  }

  return db.place.create({
    data: {
      workspaceId: WORKSPACE_ID,
      ...data,
    },
  })
}

function findHomePlace(googlePlaceId: string | null) {
  return db.place.findFirst({
    where: {
      workspaceId: WORKSPACE_ID,
      OR: [
        ...(googlePlaceId ? [{ googlePlaceId }] : []),
        { name: HOME.name, type: HOME.type },
      ],
    },
  })
}

function shouldPromote(visit: StagedVisitRow) {
  const enrichment = enrichmentRecord(visit.aiEnrichment)
  if (!visit.placeName || !visit.googlePlaceId) return false
  const reasoning = String(enrichment?.reasoning ?? "")
  return reasoning.includes("Google Places API")
}

function isHomeSemanticVisit(visit: StagedVisitRow) {
  const enrichment = enrichmentRecord(visit.aiEnrichment)
  const raw = rawTopCandidate(visit.rawData)
  return enrichment?.category === "home" || raw?.semanticType === "Home" || visit.placeName === HOME.name
}

function isResidentialNoise(visit: StagedVisitRow) {
  if (isHomeSemanticVisit(visit)) return false
  const enrichment = enrichmentRecord(visit.aiEnrichment)
  const types = googleTypes(enrichment)
  const residentialTypes = new Set(["apartment_complex", "apartment_building"])
  return types.some(type => residentialTypes.has(type))
}

function homeGoogleId(visits: StagedVisitRow[]) {
  return visits.find(isHomeSemanticVisit)?.googlePlaceId ?? null
}

function uniqueRows(visits: StagedVisitRow[]) {
  const seen = new Set<string>()
  return visits.filter(visit => {
    if (seen.has(visit.id)) return false
    seen.add(visit.id)
    return true
  })
}

function googleTypes(value: Record<string, unknown> | null) {
  return Array.isArray(value?.googleTypes)
    ? value.googleTypes.filter((item): item is string => typeof item === "string")
    : []
}

function enrichmentRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function rawTopCandidate(value: unknown) {
  if (!isRecord(value) || !isRecord(value.visit) || !isRecord(value.visit.topCandidate)) return null
  return value.visit.topCandidate
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

main().catch(async error => {
  console.error(error)
  await db.$disconnect()
  process.exit(1)
})
