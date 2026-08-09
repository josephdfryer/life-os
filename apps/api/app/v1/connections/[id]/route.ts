import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Disconnect an integration — marks the Connection mirror row disabled and,
 * best-effort, does the same on its row of truth (sourceTable/sourceId) so
 * Calendar/Gmail's own OAuth code and Era's sync scripts see the change too
 * without needing their own separate disconnect endpoint.
 *
 *   DELETE /v1/connections/<id>
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(req, "connections.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    const { db } = await import("@life-os/db")
    const connection = await db.connection.findFirst({ where: { id, workspaceId: auth.workspaceId } })
    if (!connection) return errorResponse(404, "not_found", "Connection not found")

    await db.connection.update({ where: { id }, data: { status: "disabled" } })

    if (connection.sourceTable === "CalendarConnection" && connection.sourceId) {
      await db.calendarConnection.update({ where: { id: connection.sourceId }, data: { status: "disabled" } }).catch(() => {})
    } else if (connection.sourceTable === "GmailConnection" && connection.sourceId) {
      await db.gmailConnection.update({ where: { id: connection.sourceId }, data: { status: "disabled" } }).catch(() => {})
    } else if (connection.sourceTable === "EraConnection" && connection.sourceId) {
      await db.eraConnection.update({ where: { id: connection.sourceId }, data: { status: "disabled" } }).catch(() => {})
    }

    return NextResponse.json({ status: "disabled" })
  } catch (error) {
    return handleRouteError(error)
  }
}
