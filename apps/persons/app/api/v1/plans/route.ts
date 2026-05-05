import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { createPlan } from "@/server/domain/plans"
import { formatPlan } from "@/server/domain/dto"
import { created, handleRouteError } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  if (!(await authorizeApiRequest(req, "people.read"))) return unauthorized()

  const { searchParams } = new URL(req.url)
  const personId = searchParams.get("personId")
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? 100)))
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0))

  const where = personId ? { personId } : undefined
  const [plans, total] = await Promise.all([
    db.plan.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    db.plan.count({ where }),
  ])

  return NextResponse.json({ data: plans.map(formatPlan), total, limit, offset })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    return created(await createPlan(await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
