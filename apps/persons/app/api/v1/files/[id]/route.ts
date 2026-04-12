import { NextRequest, NextResponse } from "next/server"
import { validateApiKey, unauthorized } from "@/lib/api-auth"
import { getFileContent } from "@/lib/file-storage"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!validateApiKey(req)) return unauthorized()
  const { id } = await params

  const file = await getFileContent(id)
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })

  return new NextResponse(file.content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "X-File-Format": file.format,
    },
  })
}
