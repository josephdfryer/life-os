import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"

export async function GET(request: Request) {
  try {
    const access = await requireWorkspaceAccess()
    const searchParams = new URL(request.url).searchParams
    const includeArchived = searchParams.get("archived") === "true"
    const cursor = searchParams.get("cursor") || undefined
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 40)))
    const files = await db.importedFile.findMany({
      where: { workspaceId: access.workspaceId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, filename: true, format: true, sizeBytes: true, mimeType: true, createdAt: true,
        archivedAt: true, processingState: true,
        _count: { select: { chunks: true, entityMentions: true, evidenceClaims: true } },
        processingRuns: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, summary: true, error: true, workflowRunId: true } },
      },
    })
    const hasMore = files.length > pageSize
    const page = hasMore ? files.slice(0, pageSize) : files
    return NextResponse.json({ files: page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
