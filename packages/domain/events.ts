import type { Prisma } from "@life-os/db"

// The GraphEvent spine. See docs/adr/0002-graph-event-spine.md.
//
// Every canonical command in this package writes its record changes and its
// GraphEvent in ONE transaction — pass the same `tx` the command is already
// using. This never opens its own transaction, so it composes into whatever
// the caller started.

// A superset of packages/access's DomainActor: adds "rule", because an
// automation rule acting on its own authority is a distinct provenance fact
// from a plain system process, and GraphEvent.actorType needs to record which
// one actually happened. Structurally compatible with DomainActor (same
// shape, just a wider `type` union), so callers passing either satisfy this.
export type GraphEventActor = {
  // "assistant" is distinct from "user": a write Joseph made by hand and one the
  // assistant made on his behalf need to be tellable apart after the fact, which
  // is the first question asked when something turns out wrong.
  type: "user" | "api_key" | "system" | "rule" | "assistant"
  id?: string | null
  label?: string | null
}

export type PublishGraphEventInput = {
  workspaceId: string
  subjectType: string
  subjectId: string
  eventType: string
  actor?: GraphEventActor
  sourceConnector?: string | null
  correlationId?: string | null
  causationId?: string | null
  causationDepth?: number
  ruleVersionId?: string | null
  // The same logical action always produces the same key, so retrying a
  // command can never publish the same event twice. Scoped per-workspace by
  // the unique constraint on GraphEvent, not globally.
  idempotencyKey: string
  payload: Record<string, unknown>
  provenance?: Record<string, unknown> | null
}

// Hard cap, not policy: a rule reacting to an event it produced, reacting
// again, cannot recurse past this depth no matter what a future rule-authoring
// UI allows. This is what makes an automation loop mathematically impossible
// rather than merely discouraged.
export const MAX_CAUSATION_DEPTH = 5

export async function publishGraphEvent(tx: Prisma.TransactionClient, input: PublishGraphEventInput) {
  const causationDepth = input.causationDepth ?? 0
  if (causationDepth > MAX_CAUSATION_DEPTH) {
    throw new Error(
      `GraphEvent causationDepth ${causationDepth} exceeds the maximum of ${MAX_CAUSATION_DEPTH} (automation loop guard)`,
    )
  }

  // upsert with an empty `update` is the whole idempotency guarantee: if this
  // idempotencyKey was already published (a retry, or two commands racing on
  // the same logical action), this is a no-op that returns the original row
  // rather than creating a second event or throwing a unique-constraint error
  // the caller has to catch.
  return tx.graphEvent.upsert({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    update: {},
    create: {
      workspaceId: input.workspaceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      eventType: input.eventType,
      actorType: input.actor?.type ?? "system",
      actorId: input.actor?.id ?? null,
      sourceConnector: input.sourceConnector ?? null,
      correlationId: input.correlationId ?? null,
      causationId: input.causationId ?? null,
      causationDepth,
      ruleVersionId: input.ruleVersionId ?? null,
      idempotencyKey: input.idempotencyKey,
      payload: JSON.stringify(input.payload),
      provenance: input.provenance ? JSON.stringify(input.provenance) : null,
    },
  })
}
