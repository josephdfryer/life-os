import { NextResponse } from "next/server"
import { badRequest } from "@/server/api/errors"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { createImportJob, parseFile } from "@/server/domain/import"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const actor = await requireAccess("ingest.write")
    const file = await fileFromRequest(request)
    const buffer = Buffer.from(await file.arrayBuffer())
    const job = await createImportJob({ workspaceId: actor.workspaceId, filename: file.name, buffer, actor: actor.actor })
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
    const visits = await parseFile(buffer)
    const sorted = [...visits].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    return NextResponse.json({
      format: visits[0]?.format ?? "unknown",
      totalRows: visits.length,
      firstStartedAt: sorted[0]?.startedAt?.toISOString() ?? null,
      lastStartedAt: sorted.at(-1)?.startedAt?.toISOString() ?? null,
    })
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
