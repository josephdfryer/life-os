import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { keepId, deleteId, fields } = body as {
    keepId: string
    deleteId: string
    fields: Record<string, unknown>
  }

  if (!keepId || !deleteId || keepId === deleteId) {
    return NextResponse.json({ error: "Invalid IDs" }, { status: 400 })
  }

  // Prepare scalar updates
  const data: Record<string, unknown> = {}
  const scalars = [
    "first", "last", "headline", "email", "phone", "company",
    "location", "birthday", "closeness", "linkedin", "twitter",
    "website", "notes", "color", "colorSoft",
  ]
  for (const key of scalars) {
    if (key in fields) data[key] = fields[key] ?? null
  }
  if ("tags" in fields) data.tags = JSON.stringify(Array.isArray(fields.tags) ? fields.tags : [])
  if ("values" in fields) data.values = JSON.stringify(Array.isArray(fields.values) ? fields.values : [])

  await db.$transaction(async (tx) => {
    await tx.person.update({ where: { id: keepId }, data })
    await tx.interaction.updateMany({ where: { personId: deleteId }, data: { personId: keepId } })
    await tx.plan.updateMany({ where: { personId: deleteId }, data: { personId: keepId } })
    await tx.person.delete({ where: { id: deleteId } })
  })

  return NextResponse.json({ ok: true, keptId: keepId })
}
