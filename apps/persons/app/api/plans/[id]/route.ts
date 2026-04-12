import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const { status, text, timescale } = body

  const plan = await db.plan.update({
    where: { id },
    data: {
      ...(status !== undefined && { status }),
      ...(text !== undefined && { text: text.trim() }),
      ...(timescale !== undefined && { timescale: timescale?.trim() || null }),
    },
  })

  return NextResponse.json(plan)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  await db.plan.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
