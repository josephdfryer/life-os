import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"
import { OuraError, exchangeOuraCode, grantedScopeIncludesDaily, verifyOuraState } from "@/lib/oura"
import { backfillOuraConnection, ensureOuraWebhookSubscriptions, persistOuraTokens } from "@/lib/oura-ingest"

export const maxDuration = 300

/**
 * Finishes Oura OAuth. Home's callback posts the code and signed state;
 * this route exchanges them, upserts Connection kind=oura, then runs the
 * one-time 35-day backfill and ensures webhook subscriptions.
 *
 *   POST /v1/connections/oura/callback  { code, state, scope? }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "connections.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const body = await req.json()
    const code = typeof body?.code === "string" ? body.code.trim() : ""
    const state = typeof body?.state === "string" ? body.state.trim() : ""
    const grantedScope = typeof body?.scope === "string" ? body.scope : "daily"
    if (!code || !state) return errorResponse(400, "validation", "code and state are required")

    const parsed = verifyOuraState(state)
    if (parsed.workspaceId !== auth.workspaceId) {
      return errorResponse(403, "forbidden", "Oura OAuth state does not match this workspace")
    }
    if (!grantedScopeIncludesDaily(grantedScope)) {
      return errorResponse(400, "scope", "Oura did not grant the daily scope. Reconnect and leave Daily enabled.")
    }

    const tokens = await exchangeOuraCode(code)
    const { db } = await import("@life-os/db")
    const workspaceId = auth.workspaceId
    const userId = await ownerUserId(workspaceId)
    if (!userId) return errorResponse(400, "validation", "No user found to own the Oura connection")

    const existing = await db.connection.findFirst({
      where: { workspaceId, kind: "oura", provider: "oura" },
      orderBy: { createdAt: "desc" },
    })
    const connection = existing
      ? existing
      : await db.connection.create({
          data: {
            workspaceId,
            userId,
            kind: "oura",
            provider: "oura",
            status: "active",
            label: "Oura",
            scope: grantedScope,
          },
        })

    await persistOuraTokens(connection.id, tokens, { scope: grantedScope, lastError: null })
    const stored = await db.connection.findUniqueOrThrow({ where: { id: connection.id } })

    let backfill: { start: string; end: string; daysWritten: number; daysSkipped: number; stressUnavailable: boolean } | null = null
    let backfillError: string | null = null
    try {
      backfill = await backfillOuraConnection(stored)
    } catch (error) {
      backfillError = error instanceof OuraError ? error.code : "backfill_failed"
      console.error("oura backfill failed after token persist", error)
      await db.connection.update({ where: { id: connection.id }, data: { lastError: backfillError } }).catch(() => undefined)
    }

    // Subscribe after the Turso write storm so Oura's handshake GETs do not
    // contend with the 35-day ingest. Tokens are already stored; Sync now can
    // retry the import if this request still fails.
    const webhooks = await ensureOuraWebhookSubscriptions().catch(() => ({ created: [], existing: [] }))

    return NextResponse.json({
      connection: { id: connection.id, kind: "oura", status: "active" },
      returnTo: parsed.returnTo || "/admin/connections",
      backfill,
      backfillError,
      webhooks,
    }, { status: existing ? 200 : 201 })
  } catch (error) {
    if (error instanceof OuraError) {
      const status = error.code === "not_configured" ? 503 : error.code === "forbidden" ? 403 : 400
      return errorResponse(status, error.code, error.message)
    }
    return handleRouteError(error)
  }
}

async function ownerUserId(workspaceId: string) {
  const { db } = await import("@life-os/db")
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerUserId: true, members: { where: { status: "active" }, orderBy: { createdAt: "asc" }, take: 1, select: { userId: true } } },
  })
  return workspace?.ownerUserId ?? workspace?.members[0]?.userId ?? null
}
