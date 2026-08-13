import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { getDatabaseFileContent } from "@/lib/files"
import { errorResponse, unauthorizedResponse } from "@/lib/respond"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "files.read")
  if (!auth) return unauthorizedResponse()
  const { id } = await params

  const file = await getDatabaseFileContent(id, auth.workspaceId)
  if (!file) return errorResponse(404, "not_found", "File not found")

  return new NextResponse(file.content, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "X-File-Format": file.format,
      "X-Content-Type-Options": "nosniff",
    },
  })
}
