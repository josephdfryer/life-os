import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { formatPerson } from "@/server/domain/dto"

export async function GET(req: NextRequest) {
  try {
    const access = await requireAccess("people.read")
    const ids = [...new Set(new URL(req.url).searchParams.getAll("id").filter(Boolean))]
    if (ids.length !== 2) {
      return NextResponse.json({ error: "Exactly two Person IDs are required." }, { status: 400 })
    }

    const persons = await db.person.findMany({
      where: { workspaceId: access.workspaceId, id: { in: ids } },
      include: {
        _count: { select: { interactions: true, plans: true } },
      },
    })
    if (persons.length !== 2) {
      return NextResponse.json({ error: "Person not found." }, { status: 404 })
    }

    const byId = new Map(persons.map(person => [
      person.id,
      {
        ...formatPerson(person),
        interactionCount: person._count.interactions,
        planCount: person._count.plans,
      },
    ]))

    return NextResponse.json({ persons: ids.map(id => byId.get(id)) })
  } catch (error) {
    return handleRouteError(error)
  }
}
