import { NextRequest, NextResponse } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { createInteraction } from "@/server/domain/interactions"
import { streamInteractions, type StreamParams } from "@/server/domain/interaction-stream"
import { created, handleRouteError } from "@/server/api/respond"
import { forwardCanonicalStream } from "./_canonical"

/**
 * The continuous interaction stream — everything that has happened, newest
 * first, without walking person by person.
 *
 *   /api/v1/interactions?type=financial&since=2026-07-01&limit=100
 *   /api/v1/interactions?groupId=<household>&include=place,account
 *   /api/v1/interactions?cursor=<nextCursor from the previous page>
 *
 * Pages with a keyset cursor rather than an offset, so page 100 costs the same
 * as page 1. `total` is omitted unless withTotal=1 — counting the filtered set
 * usually costs more than the page itself and almost nothing reads it.
 */
export async function GET(req: NextRequest) {
  const forwarded = await forwardCanonicalStream(req, "/v1/stream")
  if (forwarded) return forwarded

  const auth = await authorizeApiRequest(req, "interactions.read")
  if (!auth) return unauthorized()

  try {
    const { searchParams } = new URL(req.url)
    const number = (key: string) => {
      const raw = searchParams.get(key)
      return raw === null || raw === "" ? null : Number(raw)
    }

    const params: StreamParams = {
      cursor: searchParams.get("cursor"),
      limit: number("limit") ?? undefined,
      order: searchParams.get("order") === "asc" ? "asc" : "desc",
      type: searchParams.get("type"),
      subtype: searchParams.get("subtype"),
      since: searchParams.get("since"),
      until: searchParams.get("until"),
      personId: searchParams.get("personId"),
      actorPersonId: searchParams.get("actorPersonId"),
      groupId: searchParams.get("groupId"),
      placeId: searchParams.get("placeId"),
      eventId: searchParams.get("eventId"),
      category: searchParams.get("category"),
      direction: searchParams.get("direction"),
      source: searchParams.get("source"),
      q: searchParams.get("q"),
      minAmount: number("minAmount"),
      maxAmount: number("maxAmount"),
      include: searchParams.get("include"),
      withTotal: searchParams.get("withTotal") === "1" || searchParams.get("withTotal") === "true",
    }

    return NextResponse.json(await streamInteractions(params, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "interactions.write")
  if (!auth) return unauthorized()
  try {
    return created(await createInteraction(await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
