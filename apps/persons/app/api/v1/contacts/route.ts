import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { createPerson } from "@/server/domain/persons"
import { formatPerson } from "@/server/domain/dto"
import { created, handleRouteError } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "people.read")
  if (!auth) return unauthorized()

  // Bounded to the oldest 2,000 (createdAt asc, unchanged ordering) — this
  // v1 API surface had no cap at all and scaled with total Person count
  // (7,300+ and growing) on every call.
  const persons = await db.person.findMany({
    where: { workspaceId: auth.workspaceId },
    orderBy: { createdAt: "asc" },
    take: 2000,
  })

  return NextResponse.json(persons.map(formatPerson))
}

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    return created(await createPerson(await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
