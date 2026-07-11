import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { getWorkspaceId } from "@/lib/workspace"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const workspaceId = await getWorkspaceId(session.user.email)

  const { searchParams } = new URL(req.url)
  const startRaw = searchParams.get("start")
  const endRaw = searchParams.get("end")
  if (!startRaw || !endRaw) {
    return NextResponse.json({ error: "start and end are required" }, { status: 400 })
  }

  const start = new Date(startRaw)
  const end = new Date(endRaw)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid start or end" }, { status: 400 })
  }

  const events = await db.event.findMany({
    where: {
      workspaceId,
      start: { gte: start, lte: end },
      type: { notIn: ["message", "message_thread", "email"] },
    },
    include: {
      place: { select: { name: true } },
      interactions: {
        where: { personId: { not: null } },
        include: { person: { select: { first: true, last: true } } },
        take: 3,
      },
    },
    orderBy: { start: "asc" },
    take: 500,
  })

  return NextResponse.json({ data: events })
}
