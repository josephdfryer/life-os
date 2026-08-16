import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"
import { disconnectOuraConnection } from "@/lib/oura-ingest"

/**
 * Disconnect an integration — marks the Connection mirror row disabled and,
 * atomically does the same on its row of truth (sourceTable/sourceId) so
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

    await db.$transaction(async tx => {
      if (connection.sourceTable === "CalendarConnection" && connection.sourceId) {
        await tx.calendarConnection.updateMany({
          where: { id: connection.sourceId, workspaceId: auth.workspaceId },
          data: { status: "disabled" },
        })
      } else if (connection.sourceTable === "GmailConnection" && connection.sourceId) {
        await tx.gmailConnection.updateMany({
          where: { id: connection.sourceId, workspaceId: auth.workspaceId },
          data: { status: "disabled" },
        })
      } else if (connection.sourceTable === "EraConnection" && connection.sourceId) {
        await tx.eraConnection.updateMany({
          where: { id: connection.sourceId, workspaceId: auth.workspaceId },
          data: { status: "disabled" },
        })
      }
      await tx.connection.update({ where: { id }, data: { status: "disabled" } })
    })

    if (connection.kind === "oura") {
      await disconnectOuraConnection(connection).catch(() => undefined)
    }

    return NextResponse.json({ status: "disabled" })
  } catch (error) {
    return handleRouteError(error)
  }
}
