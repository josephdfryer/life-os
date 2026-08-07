// A shared, best-effort audit writer.
//
// apps/persons/server/domain/audit.ts's `auditAction` is the canonical
// implementation this mirrors exactly (same field derivation, same
// swallow-and-warn failure mode — an audit-write failure must never break the
// real command it is describing). That file owns a large Persons-specific
// `AuditAction` literal union; this one takes a plain string, because
// packages/domain does not yet own that whole vocabulary. Once more commands
// live here, Persons' auditAction can narrow itself to that union and delegate
// to this for the write itself.

export type AuditActor = {
  type: "user" | "api_key" | "system" | "rule"
  id?: string | null
  label?: string | null
  workspaceId?: string | null
}

export type WriteAuditLogInput = {
  actor?: AuditActor
  action: string
  targetType: string
  targetId?: string | null
  metadata?: Record<string, unknown>
}

export async function writeAuditLog(input: WriteAuditLogInput) {
  const { db } = await import("@life-os/db")
  const actor = input.actor ?? { type: "system" as const }
  const actorId = actor.id ?? null

  try {
    await db.auditLog.create({
      data: {
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        actorType: actor.type,
        actorId,
        actorLabel: actor.label ?? null,
        workspaceId: actor.workspaceId ?? null,
        userId: actor.type === "user" ? actorId : null,
        apiKeyId: actor.type === "api_key" && actorId !== "env" ? actorId : null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    })
  } catch (error) {
    console.warn("[audit] failed to write AuditLog", error)
  }
}
