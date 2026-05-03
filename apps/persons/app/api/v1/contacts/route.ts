import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { createPerson } from "@/server/domain/people"
import { formatPerson } from "@/server/domain/dto"
import { created, handleRouteError } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  if (!(await authorizeApiRequest(req, "contacts.read"))) return unauthorized()

  const persons = await db.person.findMany({
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(persons.map(formatPerson))
}

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "contacts.write")
  if (!auth) return unauthorized()
  try {
    return created(await createPerson(await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
