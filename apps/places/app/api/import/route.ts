import { NextResponse } from "next/server"
import { badRequest } from "@/server/api/errors"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { enrichPendingVisits } from "@/server/domain/enrichment"
import { createImportJob, previewFile } from "@/server/domain/import"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const actor = await requireAccess("ingest.write")
    const file = await fileFromRequest(request)
    const buffer = Buffer.from(await file.arrayBuffer())
    const job = await createImportJob({ workspaceId: actor.workspaceId, filename: file.name, buffer, actor: actor.actor })
    void enrichPendingVisits(actor.workspaceId).catch(error => {
      console.error("[places import] background enrichment failed", error)
    })
    return NextResponse.json(job, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PUT(request: Request) {
  try {
    await requireAccess("ingest.write")
    const file = await fileFromRequest(request)
    const buffer = Buffer.from(await file.arrayBuffer())
    return NextResponse.json(await previewFile(buffer))
  } catch (error) {
    return handleRouteError(error)
  }
}

async function fileFromRequest(request: Request) {
  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof File)) throw badRequest("file is required")
  return file
}
