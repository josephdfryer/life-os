import { NextResponse } from "next/server"
import { badRequest } from "@/server/api/errors"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { bulkUpdateStagedVisits, type StagedVisitAction } from "@/server/domain/import"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ jobId: string }> }

export async function POST(request: Request, ctx: Params) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId } = await ctx.params
    const body = await request.json()
    const action = stagedVisitAction(body?.action)
    return NextResponse.json(await bulkUpdateStagedVisits(jobId, actor.workspaceId, {
      action,
      minConfidence: optionalNumber(body?.minConfidence),
      visitIds: optionalStringArray(body?.visitIds),
      dryRun: body?.dryRun === true,
    }, actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

function stagedVisitAction(value: unknown): StagedVisitAction {
  if (value === "accept" || value === "reject") return value
  throw badRequest("action must be accept or reject")
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw badRequest("minConfidence must be a number")
  return parsed
}

function optionalStringArray(value: unknown) {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw badRequest("visitIds must be an array of strings")
  }
  return value
}
