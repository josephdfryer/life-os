import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Every third-party account connection (Calendar, Gmail, Era, Oura) in one list —
 * the read side of Track C's Connection unification
 * (docs/adr/0003-connection-model.md). Calendar/Gmail rows here are a
 * dual-written mirror of the real OAuth state (still owned by apps/events
 * and Persons' gmail domain respectively); Era rows are the row of truth.
 *
 *   GET /v1/connections
 *
 * Does not invent placeholder rows for an integration kind with zero
 * connections — "not connected yet" is a UI-layer decision (the caller
 * knows the fixed set of integration kinds to offer), not something this
 * read endpoint should guess at.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "connections.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { db } = await import("@life-os/db")
    const rows = await db.connection.findMany({
      where: { workspaceId: auth.workspaceId },
      orderBy: [{ kind: "asc" }, { accountEmail: "asc" }],
      select: {
        id: true,
        kind: true,
        provider: true,
        accountEmail: true,
        label: true,
        status: true,
        lastSyncedAt: true,
        lastError: true,
        expiresAt: true,
      },
    })

    const connections = rows.map(row => ({
      id: row.id,
      kind: row.kind,
      provider: row.provider,
      accountEmail: row.accountEmail,
      label: row.label,
      status: row.status,
      lastSyncedAt: row.lastSyncedAt,
      lastError: row.lastError,
      actions: availableActions(row.status, row.expiresAt),
    }))

    return NextResponse.json({ connections })
  } catch (error) {
    return handleRouteError(error)
  }
}

function availableActions(status: string, expiresAt: Date | null): string[] {
  const expired = expiresAt !== null && expiresAt.getTime() < Date.now()
  if (status !== "active" || expired) return ["reconnect", "disconnect"]
  return ["sync", "reconnect", "disconnect"]
}
