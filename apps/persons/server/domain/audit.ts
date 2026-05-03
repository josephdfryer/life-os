import { db } from "@/lib/db"

export type DomainActor = {
  type: "user" | "api_key" | "system"
  id?: string | null
  label?: string | null
}

export type AuditAction =
  | "person.create"
  | "person.update"
  | "person.delete"
  | "person.merge"
  | "person.dedupe"
  | "access.seed"
  | "apiKey.create"
  | "apiKey.update"
  | "role.create"
  | "role.update"
  | "user.roles.update"
  | "rule.create"
  | "rule.update"
  | "rule.run"
  | "rule.apply"
  | "event.create"
  | "plan.create"
  | "plan.update"
  | "plan.delete"
  | "interaction.create"
  | "interaction.delete"
  | "import.confirm"
  | "inbox.update"
  | "inbox.dismiss"
  | "inbox.accept"

type AuditInput = {
  actor?: DomainActor
  action: AuditAction
  targetType: string
  targetId?: string | null
  metadata?: Record<string, unknown>
}

export async function auditAction(input: AuditInput) {
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
        userId: actor.type === "user" ? actorId : null,
        apiKeyId: actor.type === "api_key" && actorId !== "env" ? actorId : null,
        personId: input.targetType === "person" ? input.targetId ?? null : null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    })
  } catch (error) {
    console.warn("[audit] failed to write AuditLog", error)
  }
}
