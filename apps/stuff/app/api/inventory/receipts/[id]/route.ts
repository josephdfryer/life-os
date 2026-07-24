import { type NextRequest, NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { readStoredFile } from "@/lib/media-storage"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  const file = await db.importedFile.findFirst({
    where: { id, workspaceId: access.workspaceId },
    select: { filePath: true, filename: true, mimeType: true },
  })
  if (!file) return NextResponse.json({ error: "Receipt not found" }, { status: 404 })
  try {
    const safeFilename = file.filename.replace(/[\r\n"]/g, "")
    return new NextResponse(await readStoredFile(file.filePath), {
      headers: {
        "Content-Type": file.mimeType ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch {
    return NextResponse.json({ error: "Receipt bytes are unavailable" }, { status: 404 })
  }
}
