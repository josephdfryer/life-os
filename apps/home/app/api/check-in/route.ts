import { NextResponse } from "next/server"
import { db } from "@life-os/db"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { auth } from "@/auth"
import { ensureStateDefinitionInTransaction, recordStateInTransaction } from "@life-os/domain"
import { runRulesForTarget } from "@life-os/automation"

const TYPES = ["energy", "mood", "stress"] as const

export async function POST(request: Request) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const session = await auth()
  const owner = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email }, select: { id: true, personId: true } })
    : await db.user.findFirst({ where: { workspaceMemberships: { some: { workspaceId, role: "owner", status: "active" } } }, select: { id: true, personId: true } })
  if (!owner?.personId) return NextResponse.json({ error: "Connect the workspace owner to a Person before recording personal States." }, { status: 409 })
  const ownerPersonId = owner.personId
  const body = await request.json().catch(() => null) as { values?: Record<string, unknown>; note?: unknown } | null
  if (!body?.values) return NextResponse.json({ error: "Check-in values are required" }, { status: 400 })
  const values = body.values
  const recordedAt = new Date()
  const actor = { type: "user" as const, id: owner.id, workspaceId }
  const recorded = await db.$transaction(async tx => {
    const states: Array<Awaited<ReturnType<typeof recordStateInTransaction>>> = []
    const sourceNote = typeof body.note === "string" && body.note.trim()
      ? await tx.note.create({
          data: { workspaceId, type: "observation", content: body.note.trim(), timestamp: recordedAt, metadata: JSON.stringify({ source: "evening-check-in" }) },
          select: { id: true },
        })
      : null
    for (const type of TYPES) {
      const value = values[type]
      if (typeof value !== "number" || value < 1 || value > 5) continue
      const definition = await ensureStateDefinitionInTransaction(tx, {
        entityType: "Person",
        type,
        value: String(value),
        description: `${type} self-rating from 1 to 5`,
      }, workspaceId)
      states.push(await recordStateInTransaction(tx, {
        entityType: "Person",
        entityId: ownerPersonId,
        definitionId: definition.id,
        severity: value,
        source: "home-evening-check-in",
        sourceNoteId: sourceNote?.id,
        recordedAt,
      }, workspaceId, actor))
    }
    return states
  })
  await Promise.all(recorded.map(({ state, definition }) => runRulesForTarget({
    trigger: "state.record",
    targetType: "state",
    targetId: state.id,
    payload: {
      stateId: state.id,
      entityType: state.entityType,
      entityId: state.entityId,
      definitionType: definition.type,
      definitionValue: definition.value,
      severity: state.severity,
    },
    actor,
  })))
  return NextResponse.json({ saved: true }, { status: 201 })
}
