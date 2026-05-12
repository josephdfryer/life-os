import { NextRequest, NextResponse } from "next/server"
import { addMember, listMembers } from "@/server/domain/groups"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("people.read")
    const members = await listMembers(id, actor.workspaceId)
    return NextResponse.json(members)
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("people.write")
    const membership = await addMember(id, await req.json(), actor.actor)
    return created(membership)
  } catch (error) {
    return handleRouteError(error)
  }
}
