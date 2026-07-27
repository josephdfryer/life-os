import { NextResponse } from "next/server"
import { db } from "@life-os/db"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { auth } from "@/auth"

const TYPES = ["energy", "mood", "stress"] as const

export async function POST(request: Request) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const session = await auth()
  const owner = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email }, select: { personId: true } })
    : await db.user.findFirst({ where: { workspaceMemberships: { some: { workspaceId, role: "owner", status: "active" } } }, select: { personId: true } })
  if (!owner?.personId) return NextResponse.json({ error: "Connect the workspace owner to a Person before recording personal States." }, { status: 409 })
  const ownerPersonId = owner.personId
  const body = await request.json().catch(() => null) as { values?: Record<string, unknown>; note?: unknown } | null
  if (!body?.values) return NextResponse.json({ error: "Check-in values are required" }, { status: 400 })
  const values = body.values
  const recordedAt = new Date()
  await db.$transaction(async tx => {
    const sourceNote = typeof body.note === "string" && body.note.trim()
      ? await tx.note.create({
          data: { workspaceId, type: "observation", content: body.note.trim(), timestamp: recordedAt, metadata: JSON.stringify({ source: "evening-check-in" }) },
          select: { id: true },
        })
      : null
    for (const type of TYPES) {
      const value = values[type]
      if (typeof value !== "number" || value < 1 || value > 5) continue
      const definition = await tx.stateDefinition.upsert({
        where: { workspaceId_entityType_type_value: { workspaceId, entityType: "Person", type, value: String(value) } },
        update: {},
        create: { workspaceId, entityType: "Person", type, value: String(value), description: `${type} self-rating from 1 to 5` },
      })
      await tx.state.create({
        data: { workspaceId, entityType: "Person", entityId: ownerPersonId, definitionId: definition.id, severity: value, source: "home-evening-check-in", sourceNoteId: sourceNote?.id, recordedAt },
      })
    }
  })
  return NextResponse.json({ saved: true }, { status: 201 })
}
