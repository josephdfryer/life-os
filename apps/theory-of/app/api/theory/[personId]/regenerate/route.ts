import { NextResponse } from "next/server"
import { regenerateTheory } from "@life-os/theory"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ personId: string }> }

// Stub regeneration: synthesizes a new append-only snapshot from the current
// graph (no AI yet — see app README). Versioning/archival is handled in the package.
export async function POST(_request: Request, { params }: Params) {
  try {
    const { personId } = await params
    const snapshotId = await regenerateTheory(personId)
    return NextResponse.json({ ok: true, snapshotId })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to regenerate theory" },
      { status: 500 }
    )
  }
}
