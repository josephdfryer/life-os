import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { created, handleRouteError } from "@/server/api/respond"
import { createPlan } from "@/server/domain/plans"

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
  try {
    const plan = await createPlan(await req.json())
    return created(plan)
  } catch (error) {
    return handleRouteError(error)
  }
}
