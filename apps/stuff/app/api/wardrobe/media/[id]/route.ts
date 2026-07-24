import { readFile } from "node:fs/promises"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireStuffAccess } from "@/lib/access"

export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  const file = await db.importedFile.findFirst({ where: { id, workspaceId: access.workspaceId } })
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    const bytes = await readFile(file.filePath)
    return new Response(bytes, {
      headers: {
        "Content-Type": file.mimeType ?? "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch {
    return NextResponse.json({ error: "The archived file is unavailable on this machine." }, { status: 404 })
  }
}
