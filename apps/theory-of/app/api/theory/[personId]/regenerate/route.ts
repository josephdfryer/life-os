import { NextResponse } from "next/server"
import { regenerateTheory, TheoryError } from "@life-os/theory"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ personId: string }> }

const THEORY_ERROR_STATUS: Record<TheoryError["code"], number> = {
  configuration: 400,
  not_found: 404,
  conflict: 409,
  provider: 502,
}

// Synthesizes a new append-only snapshot from the current graph via a real
// AI Gateway call (packages/intelligence/src/synthesize.ts). Versioning/
// archival is handled in the package.
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
    if (error instanceof TheoryError) {
      return NextResponse.json({ error: error.message }, { status: THEORY_ERROR_STATUS[error.code] })
    }
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
