import { redirect } from "next/navigation"
import { AppError } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"
import { listStagedVisits } from "@/server/domain/import"
import { getPlacesForMap } from "@/server/domain/places"
import ImportReviewClient from "./ImportReviewClient"

export const dynamic = "force-dynamic"

export default async function ImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>
  searchParams: Promise<{ status?: string }>
}) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId } = await params
    const requestedStatus = (await searchParams).status === "rejected" ? "rejected" : "pending"
    const [initial, places] = await Promise.all([
      listStagedVisits(jobId, actor.workspaceId, { pageSize: 50, status: requestedStatus }),
      getPlacesForMap(actor.workspaceId),
    ])
    return <ImportReviewClient jobId={jobId} initial={{
      ...initial,
      items: initial.items.map(item => ({
        id: item.id,
        placeName: item.placeName,
        placeAddress: item.placeAddress,
        googlePlaceId: item.googlePlaceId,
        latitude: item.latitude,
        longitude: item.longitude,
        startedAt: item.startedAt.toISOString(),
        endedAt: item.endedAt?.toISOString() ?? null,
        confidence: item.confidence,
        status: item.status,
        aiEnrichment: item.aiEnrichment,
      })),
    }} status={requestedStatus} places={places.map(place => ({
      id: place.id,
      name: place.name,
      address: place.address ?? null,
      placeType: place.placeType ?? null,
      latitude: place.latitude ?? null,
      longitude: place.longitude ?? null,
      visitCount: place.stats.visitCount,
      lastVisitAt: place.stats.lastVisitAt ?? null,
    }))} />
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login?callbackUrl=%2Fplaces%2Fimport")
    throw error
  }
}
