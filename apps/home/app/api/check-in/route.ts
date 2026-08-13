import { NextResponse } from "next/server"
import { db } from "@life-os/db"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { resolveWorkspaceOwner } from "@/lib/owner"
import { ensureStateDefinitionInTransaction, recordStateInTransaction } from "@life-os/domain"
import { runRulesForTarget } from "@life-os/automation"

const TYPES = ["energy", "mood", "stress"] as const

export async function POST(request: Request) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const owner = await resolveWorkspaceOwner(workspaceId)
  if (!owner?.personId) return NextResponse.json({ error: "Connect the workspace owner to a Person before recording personal States." }, { status: 409 })
  const ownerPersonId = owner.personId
  const body = await request.json().catch(() => null) as { values?: Record<string, unknown>; note?: unknown; slot?: unknown } | null
  if (!body?.values) return NextResponse.json({ error: "Check-in values are required" }, { status: 400 })
  const values = body.values
  const slot = body.slot === "morning" ? "morning" : "evening"
  const recordedAt = new Date()
  const actor = { type: "user" as const, id: owner.id, workspaceId }
  const recorded = await db.$transaction(async tx => {
    const states: Array<Awaited<ReturnType<typeof recordStateInTransaction>>> = []
    const sourceNote = typeof body.note === "string" && body.note.trim()
      ? await tx.note.create({
          data: { workspaceId, type: "observation", content: body.note.trim(), timestamp: recordedAt, metadata: JSON.stringify({ source: `${slot}-check-in` }) },
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
        source: `home-${slot}-check-in`,
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
