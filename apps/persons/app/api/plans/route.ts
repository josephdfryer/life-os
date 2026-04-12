import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const personId = searchParams.get("personId")

  const plans = await db.plan.findMany({
    where: personId ? { personId } : undefined,
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(plans)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { personId, text, timescale, successSignals, parentId } = body

  const plan = await db.plan.create({
    data: {
      personId: personId || null,
      text: text.trim(),
      timescale: timescale?.trim() || null,
      successSignals: Array.isArray(successSignals) ? JSON.stringify(successSignals) : null,
      status: "active",
      parentId: parentId || null,
    },
  })

  return NextResponse.json(plan, { status: 201 })
}
