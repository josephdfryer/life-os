import { NextResponse } from "next/server"
import { db } from "@life-os/db"
import { workspaceForHomeRequest } from "@/lib/request-access"

const RESULT_LIMIT = 8

export async function GET(request: Request) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const search = new URL(request.url).searchParams.get("search")?.trim() ?? ""
  if (!search) return NextResponse.json({ people: [] })

  const tokens = search.split(/\s+/).filter(Boolean).slice(0, 4)
  const people = await db.person.findMany({
    where: {
      workspaceId,
      AND: tokens.map(token => ({
        OR: [
          { first: { contains: token } },
          { last: { contains: token } },
          { nickname: { contains: token } },
          { emails: { contains: token } },
        ],
      })),
    },
    orderBy: [{ closeness: "desc" }, { last: "asc" }, { first: "asc" }],
    take: RESULT_LIMIT,
    select: { id: true, first: true, last: true, title: true, company: true, emails: true },
  })

  return NextResponse.json({
    people: people.map(person => ({
      id: person.id,
      first: person.first,
      last: person.last,
      detail: [person.title, person.company, firstListValue(person.emails)].filter(Boolean).join(" · "),
    })),
  })
}

function firstListValue(value: string) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : ""
  } catch {
    return ""
  }
}
