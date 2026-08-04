import { NextResponse } from "next/server"
import { badRequest } from "@/server/api/errors"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { resolveStagedVisit, updateStagedVisit, type StagedVisitAction } from "@/server/domain/import"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ jobId: string; visitId: string }> }

export async function PATCH(request: Request, ctx: Params) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId, visitId } = await ctx.params
    const body = await request.json()
    const action = stagedVisitAction(body?.action)
    if (action === "accept" && body?.resolution) {
      return NextResponse.json(await resolveStagedVisit(
        jobId,
        visitId,
        actor.workspaceId,
        resolutionInput(body.resolution),
        actor.actor,
      ))
    }
    return NextResponse.json(await updateStagedVisit(jobId, visitId, actor.workspaceId, action, actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

function resolutionInput(value: unknown) {
  if (!isRecord(value)) throw badRequest("resolution must be an object")
  if (value.mode === "merge") {
    if (typeof value.placeId !== "string" || !value.placeId.trim()) throw badRequest("resolution.placeId is required")
    return { targetPlaceId: value.placeId.trim() }
  }
  if (value.mode === "create") {
    if (typeof value.name !== "string" || !value.name.trim()) throw badRequest("resolution.name is required")
    return {
      placeOverride: {
        placeName: value.name.trim(),
        placeAddress: optionalString(value.address),
        placeType: optionalString(value.placeType),
      },
    }
  }
  throw badRequest("resolution.mode must be merge or create")
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stagedVisitAction(value: unknown): StagedVisitAction {
  if (value === "accept" || value === "reject" || value === "skip" || value === "restore") return value
  throw badRequest("action must be accept, reject, skip, or restore")
}
