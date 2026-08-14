import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const access = await requireWorkspaceAccess()
    const { fileId } = await context.params
    const cursor = new URL(request.url).searchParams.get("chunkCursor") || undefined
    const chunkLimit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("chunkLimit") ?? 50)))
    const latestChunk = await db.fileChunk.aggregate({ where: { sourceFileId: fileId, workspaceId: access.workspaceId }, _max: { version: true } })
    const file = await db.importedFile.findFirst({
      where: { id: fileId, workspaceId: access.workspaceId },
      include: {
        processingRuns: { orderBy: { createdAt: "desc" } },
        chunks: { where: { version: latestChunk._max.version ?? 0 }, orderBy: [{ ordinal: "asc" }, { id: "asc" }], take: chunkLimit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) },
        entityMentions: { orderBy: { createdAt: "asc" }, include: { resolvedPerson: { select: { id: true, first: true, last: true } } } },
        evidenceClaims: { orderBy: { createdAt: "asc" }, include: { subjects: { include: { mention: { include: { resolvedPerson: { select: { id: true, first: true, last: true } } } } } } } },
      },
    })
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })
    const hasMoreChunks = file.chunks.length > chunkLimit
    const chunks = hasMoreChunks ? file.chunks.slice(0, chunkLimit) : file.chunks
    return NextResponse.json({ file: { ...file, chunks }, nextChunkCursor: hasMoreChunks ? chunks.at(-1)?.id ?? null : null })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const access = await requireWorkspaceAccess()
    const { fileId } = await context.params
    const body = await request.json().catch(() => null) as { action?: string; reason?: string } | null
    if (body?.action !== "archive" && body?.action !== "restore") return NextResponse.json({ error: "Action must be archive or restore" }, { status: 400 })
    const exists = await db.importedFile.findFirst({ where: { id: fileId, workspaceId: access.workspaceId }, select: { id: true } })
    if (!exists) return NextResponse.json({ error: "File not found" }, { status: 404 })
    const file = await db.importedFile.update({ where: { id: fileId }, data: body.action === "archive"
      ? { archivedAt: new Date(), archiveReason: body.reason?.trim() || null }
      : { archivedAt: null, archiveReason: null } })
    return NextResponse.json({ file })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
