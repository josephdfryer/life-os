import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") ?? "pending"
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 100)))

  const items = await db.stagedInteraction.findMany({
    where: status === "all" ? undefined : { status },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    include: {
      candidatePerson: {
        select: {
          id: true,
          first: true,
          last: true,
          title: true,
          company: true,
          emails: true,
          phones: true,
        },
      },
    },
  })

  return NextResponse.json({
    items: items.map(item => ({
      ...item,
      candidatePerson: item.candidatePerson ? {
        ...item.candidatePerson,
        emails: parseTags(item.candidatePerson.emails),
        phones: parseTags(item.candidatePerson.phones),
      } : null,
    })),
  })
}
