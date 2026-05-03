export type DomainActor = {
  type: "user" | "api_key" | "system"
  id?: string | null
  label?: string | null
}

export type AuditAction =
  | "person.create"
  | "person.update"
  | "person.delete"
  | "interaction.create"
  | "interaction.delete"
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
  // Phase 1 seam: this is intentionally centralized before adding an AuditLog table.
  console.info("[audit]", {
    actor: input.actor ?? { type: "system" },
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
  })
}
