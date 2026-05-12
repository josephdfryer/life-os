import { NextRequest, NextResponse } from "next/server"
import { deleteGroup, getGroup, updateGroup } from "@/server/domain/groups"
import { handleRouteError, noContent } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const actor = await requireAccess("people.read")
  const group = await getGroup(id, actor.workspaceId)
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(group)
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("people.write")
    return NextResponse.json(await updateGroup(id, await req.json(), actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("people.write")
    await deleteGroup(id, actor.actor)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
