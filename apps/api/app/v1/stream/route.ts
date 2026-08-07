import { NextRequest, NextResponse } from "next/server"
import { streamInteractions, type StreamParams } from "@life-os/domain"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * The continuous interaction stream — everything that has happened, newest
 * first, without walking person by person. The canonical home of the
 * endpoint apps/persons has served in production as /api/v1/interactions;
 * that route now forwards here.
 *
 *   /v1/stream?type=financial&since=2026-07-01&limit=100
 *   /v1/stream?groupId=<household>&include=place,account
 *   /v1/stream?cursor=<nextCursor from the previous page>
 *
 * Pages with a keyset cursor rather than an offset, so page 100 costs the same
 * as page 1. `total` is omitted unless withTotal=1.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "interactions.read")
  if (!auth) return unauthorizedResponse()

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
