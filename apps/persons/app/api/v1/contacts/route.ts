import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { validateApiKey, unauthorized } from "@/lib/api-auth"
import { createPerson } from "@/server/domain/people"
import { formatPerson } from "@/server/domain/dto"
import { created, handleRouteError } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  if (!validateApiKey(req)) return unauthorized()

  const persons = await db.person.findMany({
    include: { interactions: { orderBy: { timestamp: "desc" } }, plans: true },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(persons.map(formatPerson))
}

export async function POST(req: NextRequest) {
  if (!validateApiKey(req)) return unauthorized()
  try {
    return created(await createPerson(await req.json(), { type: "api_key", label: "v1" }))
  } catch (error) {
    return handleRouteError(error)
  }
}
