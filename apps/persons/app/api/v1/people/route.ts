import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { createPerson } from "@/server/domain/people"
import { formatPerson } from "@/server/domain/dto"
import { created, handleRouteError } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "contacts.read")
  if (!auth) return unauthorized()

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search")
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? 200)))
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0))

  const where = search
    ? {
        OR: [
          { first: { contains: search } },
          { last: { contains: search } },
          { emails: { contains: search } },
          { company: { contains: search } },
          { headline: { contains: search } },
        ],
      }
    : undefined

  const [persons, total] = await Promise.all([
    db.person.findMany({ where, orderBy: { createdAt: "asc" }, take: limit, skip: offset }),
    db.person.count({ where }),
  ])

  return NextResponse.json({ data: persons.map(formatPerson), total, limit, offset })
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
