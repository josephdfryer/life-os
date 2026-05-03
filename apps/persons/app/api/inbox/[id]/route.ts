import { NextRequest, NextResponse } from "next/server"
import { updateInboxItem } from "@/server/domain/inbox"
import { handleRouteError } from "@/server/api/respond"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    return NextResponse.json(await updateInboxItem(id, await req.json()))
  } catch (error) {
    return handleRouteError(error)
  }
}
