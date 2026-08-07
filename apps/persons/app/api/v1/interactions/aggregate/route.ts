import { NextRequest, NextResponse } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { aggregateInteractions, type StreamParams } from "@/server/domain/interaction-stream"
import { handleRouteError } from "@/server/api/respond"

/**
 * "How much / how many", answered by the database instead of by shipping rows.
 *
 *   /api/v1/interactions/aggregate?groupBy=category&type=financial&direction=paid
 *   /api/v1/interactions/aggregate?groupBy=month&since=2026-01-01
 *   /api/v1/interactions/aggregate?groupBy=merchant&groupId=<household>&limit=10
 *
 * Accepts the same filters as the stream, so a total and the rows behind it can
 * never disagree about what was counted.
 *
 * groupBy: type, subtype, direction, category, merchant, source, month, day,
 *          actor, person, place, account
 * metric:  sum (default), count, avg, max, min
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "interactions.read")
  if (!auth) return unauthorized()

  try {
    const { searchParams } = new URL(req.url)
    const number = (key: string) => {
      const raw = searchParams.get(key)
      return raw === null || raw === "" ? null : Number(raw)
    }

    const params: StreamParams & { groupBy?: string | null; metric?: string | null } = {
      groupBy: searchParams.get("groupBy"),
      metric: searchParams.get("metric"),
      limit: number("limit") ?? undefined,
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
    }

    return NextResponse.json(await aggregateInteractions(params, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
