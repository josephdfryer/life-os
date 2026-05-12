import { NextRequest, NextResponse } from "next/server"
import { createGroup, listGroups } from "@/server/domain/groups"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

export async function GET(req: NextRequest) {
  const actor = await requireAccess("people.read")
  const { searchParams } = new URL(req.url)

  const result = await listGroups(actor.workspaceId, {
    groupType: searchParams.get("groupType") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    page: searchParams.get("page") ? parseInt(searchParams.get("page")!) : undefined,
    limit: searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : undefined,
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("people.write")
    const group = await createGroup(await req.json(), actor.actor)
    return created(group)
  } catch (error) {
    return handleRouteError(error)
  }
}
