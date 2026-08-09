import { randomUUID } from "node:crypto"
import { publishGraphEvent, type GraphEventActor } from "./events"

// The canonical Interaction's own safe-to-automate field patch — the
// generalized counterpart to staged-interactions.ts's setStagedInteractionField,
// now that Track C wires automation actions to the primitives beyond
// StagedInteraction. Whitelisted the same way: only reversible enrichment
// fields, never anything relationship- or money-critical (personId, amount,
// direction stay confirm-tier/human-only).

const INTERACTION_SAFE_FIELDS = new Set(["emotionalWeight", "outcome", "actionItems", "summary"])

export class InteractionFieldError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "InteractionFieldError"
  }
}

export type SetInteractionFieldInput = {
  id: string
  field: string
  value: unknown
  workspaceId?: string
  actor?: GraphEventActor
}

export async function setInteractionField(input: SetInteractionFieldInput) {
  const { db } = await import("@life-os/db")
  const workspaceId = input.workspaceId ?? "default-workspace"

  if (!INTERACTION_SAFE_FIELDS.has(input.field)) {
    throw new InteractionFieldError(`"${input.field}" is not a safe-to-automate Interaction field`, "validation")
  }

  const existing = await db.interaction.findFirst({ where: { id: input.id, workspaceId }, select: { id: true } })
  if (!existing) throw new InteractionFieldError("Interaction not found", "not_found")

  const value = typeof input.value === "string" ? input.value : String(input.value ?? "")

  const updated = await db.$transaction(async tx => {
    const interaction = await tx.interaction.update({
      where: { id: input.id },
      data: { [input.field]: value },
      select: { id: true, [input.field]: true },
    })

    // Unlike accept/create commands, "set this field" has no natural stable
    // idempotency boundary — the caller (a rule's action executor) doesn't
    // pass one, and setting the same field to the same value twice on
    // purpose is a real, distinct occurrence, not a retry to dedupe. A
    // random key means a genuine network-level retry could double-publish;
    // acceptable here since nothing upstream retries this call today.
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Interaction",
      subjectId: input.id,
      eventType: "interaction.field_set",
      actor: input.actor,
      idempotencyKey: `interaction-field-set:${input.id}:${input.field}:${randomUUID()}`,
      payload: { field: input.field, value },
    })

    return interaction
  })

  return updated
}
