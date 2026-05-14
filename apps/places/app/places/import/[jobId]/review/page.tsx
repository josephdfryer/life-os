import { redirect } from "next/navigation"
import { AppError } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"
import { listStagedVisits } from "@/server/domain/import"
import ImportReviewClient from "./ImportReviewClient"

export const dynamic = "force-dynamic"

export default async function ImportReviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId } = await params
    const initial = await listStagedVisits(jobId, actor.workspaceId, { pageSize: 50, status: "pending" })
    return <ImportReviewClient jobId={jobId} initial={{
      ...initial,
      items: initial.items.map(item => ({
        id: item.id,
        placeName: item.placeName,
        placeAddress: item.placeAddress,
        googlePlaceId: item.googlePlaceId,
        startedAt: item.startedAt.toISOString(),
        endedAt: item.endedAt?.toISOString() ?? null,
        confidence: item.confidence,
        status: item.status,
      })),
    }} />
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login?callbackUrl=%2Fplaces%2Fimport")
    throw error
  }
}
