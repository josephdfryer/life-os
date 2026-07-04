import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { getWorkspaceId } from "@/lib/workspace"

export async function GET() {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const workspaceId = await getWorkspaceId(session.user.email)

  const people = await db.person.findMany({
    where: { workspaceId },
    select: { id: true, first: true, last: true, emails: true },
    orderBy: [{ first: "asc" }, { last: "asc" }],
    take: 500,
  })

  return NextResponse.json(people)
}