import { NextRequest, NextResponse } from "next/server"
import { regenerateTheory } from "@life-os/intelligence"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Trigger a real AI-backed Theory of Person synthesis and persist it as a
 * new snapshot version.
 *
 *   POST /v1/theory/<personId>/regenerate
 *
 * The canonical command/API surface for this — apps/theory-of's own
 * Regenerate button calls the same underlying regenerateTheory() directly
 * (same app, no HTTP hop needed), but any other consumer (Home) should call
 * this route rather than growing its own duplicate trigger.
 *
 * Manual, human-triggered only — this makes a real, billed AI Gateway call.
 * Costs real money and can take a while; there is no automatic/scheduled
 * path to this route anywhere in the system.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ personId: string }> }) {
  const auth = await authorizeRequest(req, "intelligence.write")
  if (!auth) return unauthorizedResponse()

  try {
    const { personId } = await params
    const { db } = await import("@life-os/db")
    const person = await db.person.findFirst({ where: { id: personId, workspaceId: auth.workspaceId }, select: { id: true } })
    if (!person) return errorResponse(404, "not_found", "Person not found")

    const snapshotId = await regenerateTheory(personId, auth.workspaceId)
    return NextResponse.json({ snapshotId })
  } catch (error) {
    return handleRouteError(error)
  }
}
