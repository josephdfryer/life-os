import { badRequest, notFound } from "@/server/api/errors"
import type { DomainActor } from "./audit"
import { formatInteraction } from "./dto"
import { runRulesForTarget } from "./rules"
import {
  createInteraction as sharedCreateInteraction,
  updateInteraction as sharedUpdateInteraction,
  deleteInteraction as sharedDeleteInteraction,
  InteractionError,
  type InteractionInput,
} from "@life-os/domain"

export type { InteractionInput }

function translate<T>(promise: Promise<T>): Promise<T> {
  return promise.catch(error => {
    if (error instanceof InteractionError) throw error.code === "not_found" ? notFound(error.message) : badRequest(error.message)
    throw error
  })
}

export async function createInteraction(input: InteractionInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const interaction = await translate(sharedCreateInteraction(input, workspaceId, actor))
  await runRulesForTarget({
    trigger: "interaction.create",
    targetType: "interaction",
    targetId: interaction.id,
    payload: {
      interactionId: interaction.id,
      personId: interaction.personId,
      eventId: interaction.eventId,
      type: interaction.type,
      timestamp: interaction.timestamp.toISOString(),
      summary: interaction.summary,
      emotionalWeight: interaction.emotionalWeight,
      outcome: interaction.outcome,
      direction: interaction.direction,
      sourceFileId: interaction.sourceFileId,
    },
    actor,
  })
  return formatInteraction(interaction)
}

export async function updateInteraction(id: string, input: Partial<InteractionInput>, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  return formatInteraction(await translate(sharedUpdateInteraction(id, input, workspaceId, actor)))
}

export async function deleteInteraction(id: string, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  await translate(sharedDeleteInteraction(id, workspaceId, actor))
}

// Moved to @life-os/domain (packages/domain/staged-interactions.ts) so
// apps/home can call the exact same write instead of maintaining its own
// re-implementation — Home's independent copy had already drifted (missing
// "gmail" from the no-Event source list). The function now also publishes a
// GraphEvent transactionally with the write it makes; nothing else changed
// about its behavior or signature, so every existing caller here and in
// gmail.ts keeps working unmodified.
export { appendDailySourceInteraction } from "@life-os/domain"
