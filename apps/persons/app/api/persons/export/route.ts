import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"
import { parseTags } from "@/lib/utils"

export async function GET() {
  try {
    const actor = await requireAccess("people.read")

    const people = await db.person.findMany({
      where: { workspaceId: actor.workspaceId },
      include: {
        interactions: {
          select: { id: true, type: true, timestamp: true, summary: true, emotionalWeight: true, outcome: true },
          orderBy: { timestamp: "desc" },
        },
      },
      orderBy: { createdAt: "asc" },
    })

    const exported = people.map(p => ({
      ...p,
      tags: parseTags(p.tags as unknown as string),
      values: parseTags(p.values as unknown as string),
      emails: parseTags(p.emails as unknown as string),
      phones: parseTags(p.phones as unknown as string),
    }))

    const date = new Date().toISOString().slice(0, 10)
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), count: exported.length, people: exported }, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="people-backup-${date}.json"`,
      },
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
