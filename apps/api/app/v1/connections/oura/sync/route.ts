import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"
import { OURA_BACKFILL_DAYS, OuraError } from "@/lib/oura"
import { backfillOuraConnection, ensureOuraWebhookSubscriptions } from "@/lib/oura-ingest"

export const maxDuration = 300

/**
 * Re-runs the Oura daily import for the connected account (same 35-day
 * window as first connect) and refreshes webhook subscriptions.
 *
 *   POST /v1/connections/oura/sync
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "connections.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { db } = await import("@life-os/db")
    const connection = await db.connection.findFirst({
      where: { workspaceId: auth.workspaceId, kind: "oura", provider: "oura", status: "active" },
      orderBy: { createdAt: "desc" },
    })
    if (!connection) return errorResponse(404, "not_found", "No active Oura connection")

    const backfill = await backfillOuraConnection(connection, OURA_BACKFILL_DAYS)
    const webhooks = await ensureOuraWebhookSubscriptions().catch(() => ({ created: [], existing: [] }))
    return NextResponse.json({
      connection: { id: connection.id, kind: "oura", status: "active" },
      backfill,
      webhooks,
    })
  } catch (error) {
    if (error instanceof OuraError) {
      const status = error.code === "not_configured" ? 503 : error.code === "revoked" ? 401 : error.code === "forbidden" ? 403 : 400
      return errorResponse(status, error.code, error.message)
    }
    return handleRouteError(error)
  }
}
