import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

export async function GET(req: NextRequest) {
  try {
    const access = await requireAccess("people.read")
    const { searchParams } = new URL(req.url)
    const query = searchParams.get("q")?.trim() ?? ""
    const excludeId = searchParams.get("excludeId")?.trim() || undefined

    if (query.length < 2) return NextResponse.json({ persons: [] })

    const tokens = query.split(/\s+/).filter(Boolean).slice(0, 4)
    const persons = await db.person.findMany({
      where: {
        workspaceId: access.workspaceId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        AND: tokens.map(token => ({
          OR: [
            { first: { contains: token } },
            { last: { contains: token } },
            { nickname: { contains: token } },
            { emails: { contains: token } },
            { phones: { contains: token } },
            { company: { contains: token } },
          ],
        })),
      },
      orderBy: [{ last: "asc" }, { first: "asc" }],
      take: 8,
      select: {
        id: true,
        first: true,
        last: true,
        nickname: true,
        company: true,
        emails: true,
        phones: true,
      },
    })

    return NextResponse.json({
      persons: persons.map(person => ({
        ...person,
        emails: parseTags(person.emails),
        phones: parseTags(person.phones),
      })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
