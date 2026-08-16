import { NextResponse } from "next/server"
import { regenerateTheory, TheoryError } from "@life-os/intelligence"
import { db } from "@/lib/db"
import { requireAccess } from "@/server/domain/access"
import { notFound } from "@/server/api/errors"
import { handleRouteError } from "@/server/api/respond"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

const THEORY_ERROR_STATUS: Record<TheoryError["code"], number> = {
  configuration: 400,
  not_found: 404,
  conflict: 409,
  provider: 502,
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const actor = await requireAccess("intelligence.write")
    const { id } = await params
    const person = await db.person.findFirst({
      where: { id, workspaceId: actor.workspaceId },
      select: { id: true },
    })
    if (!person) throw notFound("Person not found")

    const snapshotId = await regenerateTheory(id, actor.workspaceId)
    return NextResponse.json({ ok: true, snapshotId })
  } catch (error) {
    if (error instanceof TheoryError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: THEORY_ERROR_STATUS[error.code] })
    }
    return handleRouteError(error)
  }
}
