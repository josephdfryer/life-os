import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { createPerson } from "@/server/domain/persons"
import { formatPerson } from "@/server/domain/dto"
import { created, handleRouteError } from "@/server/api/respond"
import { cursorPage, dateKeysetSeek, parsePageRequest } from "@/server/api/date-keyset"

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "people.read")
  if (!auth) return unauthorized()

  try {
    const { searchParams } = new URL(req.url)
    const { cursor, limit } = parsePageRequest(searchParams, { limit: 200 })
    const persons = await db.person.findMany({
      where: {
        workspaceId: auth.workspaceId,
        ...(cursor ? { AND: [dateKeysetSeek("createdAt", cursor, "asc")] } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    })
    const page = cursorPage(persons, limit, person => person.createdAt)

    return NextResponse.json({ ...page, data: page.data.map(formatPerson) })
  } catch (error) {
    return handleRouteError(error)
  }
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
