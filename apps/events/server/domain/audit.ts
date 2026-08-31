import { db } from "@/lib/db"

export type DomainActor = {
  type: "user" | "api_key" | "system"
  id?: string | null
  label?: string | null
  workspaceId?: string | null
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
  | "event.update"
  | "event.delete"
  | "plan.create"
  | "plan.update"
  | "plan.delete"
  | "interaction.create"
  | "interaction.update"
  | "interaction.delete"
  | "rule.delete"
  | "import.confirm"
  | "inbox.stage"
  | "inbox.update"
  | "inbox.dismiss"
  | "inbox.accept"
  | "inbox.apply_suggestions"
  | "approvedEmail.create"
  | "approvedEmail.update"
  | "calendar.connect"
  | "calendar.sync"
  | "calendar.attendance_default"
  | "gmail.connect"
  | "gmail.sync"
  | "group.create"
  | "group.update"
  | "group.delete"
  | "group.member.add"
  | "group.member.remove"
  | "group.place.add"
  | "group.place.remove"
  | "group.subgroup.add"
  | "place.note.create"
  | "place.note.update"
  | "place.note.delete"
  | "place.favorite.toggle"
  | "places.import.create"
  | "places.import.visit.accept"
  | "places.import.visit.reject"
  | "places.import.visit.reject_bulk"
  | "places.import.finish"

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
        workspaceId: actor.workspaceId ?? null,
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
