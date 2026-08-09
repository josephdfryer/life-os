import { z } from "@life-os/contracts"

// A trigger declares the shape of the payload it carries, so a rule's
// conditions can be checked against known fields instead of purely blind
// dot-path reflection into whatever the caller happened to pass. Registering
// a trigger is optional — an unregistered trigger name still runs (payload
// validated against a permissive z.record fallback) so this never blocks a
// caller from firing a new trigger before it has a formal schema. It exists
// to make the known, load-bearing triggers self-documenting and to catch a
// payload that's silently missing a field a condition depends on.

const TRIGGER_REGISTRY = new Map<string, z.ZodTypeAny>()

export function registerTrigger(name: string, payloadSchema: z.ZodTypeAny) {
  TRIGGER_REGISTRY.set(name, payloadSchema)
}

export function getTriggerSchema(name: string): z.ZodTypeAny {
  return TRIGGER_REGISTRY.get(name) ?? z.record(z.string(), z.unknown())
}

export function isRegisteredTrigger(name: string): boolean {
  return TRIGGER_REGISTRY.has(name)
}

export function listRegisteredTriggers(): string[] {
  return [...TRIGGER_REGISTRY.keys()].sort()
}

// The two triggers actually fired in production today (apps/persons/server/
// domain/inbox.ts's stageRecord and acceptInboxItem). Registering the real
// ones first, rather than every hypothetical future trigger, matches the
// plan's "no conversion phase — build fresh" stance for A5: there is
// nothing to migrate, only what's live to describe accurately.
registerTrigger("inbox.stage", z.object({
  stagedInteractionId: z.string(),
  source: z.string(),
  sourceId: z.string(),
  itemType: z.string(),
  type: z.string(),
  timestamp: z.string(),
  summary: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  direction: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  candidatePersonId: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  matchReason: z.string().nullable().optional(),
  priority: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
}).passthrough())

// Track C: the first primitive triggers beyond the StagedInteraction queue.
// Fired from apps/persons/server/domain/persons.ts's createPerson/
// updatePerson shim (packages/domain never depends on packages/automation,
// so the shared command itself can't fire these — the app-layer shim does).
registerTrigger("person.create", z.object({
  personId: z.string(),
  first: z.string(),
  last: z.string(),
}).passthrough())

registerTrigger("person.update", z.object({
  personId: z.string(),
  fields: z.array(z.string()),
}).passthrough())

registerTrigger("inbox.accept", z.object({
  stagedInteractionId: z.string(),
  interactionId: z.string(),
  personId: z.string().nullable().optional(),
  source: z.string(),
  sourceId: z.string(),
  itemType: z.string(),
  type: z.string(),
  timestamp: z.string(),
  summary: z.string().nullable().optional(),
  direction: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
}).passthrough())
