import { NextRequest, NextResponse } from "next/server"
import { contractIssues, noteCreateContract } from "@life-os/contracts"
import { captureNote } from "@life-os/domain"
import { authorizeRequest } from "@/lib/auth"
import { formatNoteResource, listNotes } from "@/lib/notes"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "notes.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    const rawLimit = searchParams.get("limit")
    return NextResponse.json(await listNotes({
      cursor: searchParams.get("cursor"),
      limit: rawLimit === null || rawLimit === "" ? undefined : Number(rawLimit),
      q: searchParams.get("q") ?? searchParams.get("search"),
      type: searchParams.get("type"),
      aboutPersonId: searchParams.get("aboutPersonId") ?? searchParams.get("personId"),
      aboutPlaceId: searchParams.get("aboutPlaceId") ?? searchParams.get("placeId"),
      aboutItemId: searchParams.get("aboutItemId") ?? searchParams.get("itemId"),
      aboutEventId: searchParams.get("aboutEventId") ?? searchParams.get("eventId"),
      aboutPlanId: searchParams.get("aboutPlanId") ?? searchParams.get("planId"),
      aboutGroupId: searchParams.get("aboutGroupId") ?? searchParams.get("groupId"),
      aboutStateId: searchParams.get("aboutStateId") ?? searchParams.get("stateId"),
    }, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "notes.write")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = noteCreateContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid note.", contractIssues(parsed.error))
    const { note, created } = await captureNote({
      workspaceId: auth.workspaceId,
      content: parsed.data.content,
      type: parsed.data.type,
      source: parsed.data.source ?? "api",
      timestamp: parsed.data.timestamp ? new Date(parsed.data.timestamp) : undefined,
      idempotencyKey: parsed.data.idempotencyKey,
      metadata: parsed.data.metadata ?? null,
      aboutPersonId: parsed.data.aboutPersonId,
      aboutPlaceId: parsed.data.aboutPlaceId,
      aboutItemId: parsed.data.aboutItemId,
      aboutEventId: parsed.data.aboutEventId,
      aboutPlanId: parsed.data.aboutPlanId,
      aboutGroupId: parsed.data.aboutGroupId,
      aboutStateId: parsed.data.aboutStateId,
    })
    return NextResponse.json(formatNoteResource(note), { status: created ? 201 : 200 })
  } catch (error) {
    return handleRouteError(error)
  }
}
