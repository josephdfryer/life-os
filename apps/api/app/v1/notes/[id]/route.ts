import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { getNoteResource } from "@/lib/notes"
import { handleRouteError, unauthorizedResponse } from "@/lib/respond"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "notes.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    return NextResponse.json(await getNoteResource(id, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
