import { NextResponse } from "next/server"
import { regenerateTheory } from "@life-os/theory"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ personId: string }> }

// Stub regeneration: synthesizes a new append-only snapshot from the current
// graph (no AI yet — see app README). Versioning/archival is handled in the package.
export async function POST(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspaceAccess()
    const { personId } = await params

    const person = await db.person.findFirst({
      where: { id: personId, workspaceId: access.workspaceId },
      select: { id: true },
    })
    if (!person) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 })
    }

    const snapshotId = await regenerateTheory(personId, access.workspaceId)
    return NextResponse.json({ ok: true, snapshotId })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
