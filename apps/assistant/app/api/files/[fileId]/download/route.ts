import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"
import { getFileStorage } from "@life-os/files"

export async function GET(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const access = await requireWorkspaceAccess()
    const { fileId } = await context.params
    const file = await db.importedFile.findFirst({ where: { id: fileId, workspaceId: access.workspaceId } })
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })
    const storage = getFileStorage()
    const key = file.storageKey ?? file.filePath
    const signed = await storage.createDownload(key, file.filename)
    if (signed) return NextResponse.redirect(signed.url)
    const bytes = await storage.read(key)
    return new NextResponse(bytes as BodyInit, { headers: {
      "content-type": file.mimeType ?? "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "cache-control": "private, no-store",
    } })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
