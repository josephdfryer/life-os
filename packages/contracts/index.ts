import { z } from "zod"

const id = z.string().trim().min(1).max(256)
const stringList = z.array(z.string().trim().min(1).max(512)).max(500)
const record = z.record(z.string(), z.unknown())
export const storedRecord = record

export const storedStringList = z.array(z.string().trim().min(1).max(2_000)).max(5_000)

export const ruleConditionContract = z.object({
  field: z.string().trim().min(1).max(256),
  operator: z.enum(["equals", "not_equals", "contains", "in", "exists", "not_exists", "gte", "lte"]),
  value: z.unknown().optional(),
}).strict()

export const ruleActionContract = z.object({
  type: z.string().trim().min(1).max(256),
  field: z.string().trim().min(1).max(256).optional(),
  value: z.unknown().optional(),
}).strict()

export const ruleConditionsContract = z.array(ruleConditionContract).max(100)
export const ruleActionsContract = z.array(ruleActionContract).max(100)

const emailPartyContract = z.object({
  email: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
}).passthrough()

export const gmailMessageMetadataContract = z.object({
  source: z.literal("gmail").optional(),
  gmailMessageId: z.string().optional(),
  threadId: z.string().nullable().optional(),
  historyId: z.string().nullable().optional(),
  labelIds: z.array(z.string()).optional(),
  subject: z.string().nullable().optional(),
  from: z.array(emailPartyContract).optional(),
  to: z.array(emailPartyContract).optional(),
  cc: z.array(emailPartyContract).optional(),
  bcc: z.array(emailPartyContract).optional(),
  snippet: z.string().nullable().optional(),
}).passthrough()

export const calendarEventMetadataContract = z.object({
  source: z.literal("google-calendar").optional(),
  calendarId: z.string().optional(),
  googleEventId: z.string().optional(),
  googleEventKey: z.string().optional(),
  htmlLink: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  attendees: z.array(z.object({
    email: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    responseStatus: z.string().nullable().optional(),
    self: z.boolean().optional(),
  }).passthrough()).optional(),
}).passthrough()

export class StoredJsonError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`Invalid stored JSON for ${field}: ${message}`)
    this.name = "StoredJsonError"
  }
}

export function decodeStoredJson<T>(raw: string | null | undefined, schema: z.ZodType<T>, field: string, fallback: T): T {
  if (!raw) return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new StoredJsonError(field, "malformed JSON")
  }
  const result = schema.safeParse(parsed)
  if (!result.success) throw new StoredJsonError(field, result.error.issues[0]?.message ?? "schema mismatch")
  return result.data
}

export function encodeStoredJson<T>(value: unknown, schema: z.ZodType<T>, field: string): string {
  const result = schema.safeParse(value)
  if (!result.success) throw new StoredJsonError(field, result.error.issues[0]?.message ?? "schema mismatch")
  return JSON.stringify(result.data)
}

export const mergePersonContract = z.object({
  keepId: id,
  deleteId: id,
  fields: record.optional(),
}).strict().refine(value => value.keepId !== value.deleteId, {
  message: "keepId and deleteId must be different",
  path: ["deleteId"],
})

export const mergePersonPairsContract = z.object({
  pairs: z.array(z.object({ keepId: id, deleteId: id }).strict()).min(1).max(500),
}).strict()

export const mergePersonClustersContract = z.object({
  pairs: z.array(z.object({ aId: id, bId: id }).strict()).min(1).max(500),
}).strict()

export const bulkDeletePeopleContract = z.object({
  ids: z.array(id).min(1).max(500),
}).strict()

export const bulkCreatePeopleContract = z.object({
  contacts: z.array(z.object({
    first: z.string().trim().min(1).max(200),
    last: z.string().trim().max(200),
    email: z.string().trim().max(512).optional().nullable(),
    emails: stringList.optional(),
    phone: z.string().trim().max(100).optional().nullable(),
    phones: stringList.optional(),
  }).passthrough()).min(1).max(500),
}).strict()

export const bulkUpdatePeopleContract = z.object({
  updates: z.array(z.object({ id, fields: record }).strict()).min(1).max(200),
}).strict()

export const approvedEmailContract = z.object({
  email: z.email().max(320),
  workspaceId: id.optional().nullable(),
}).strict()

export const createRoleContract = z.object({
  key: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional().nullable(),
  scopes: stringList.default([]),
}).strict()

export const updateUserRolesContract = z.object({
  roleIds: z.array(id).max(100),
}).strict()

const importedInteractionContract = z.object({
  eventType: z.string().trim().min(1).max(200),
  date: z.string().trim().min(1).max(100),
  summary: z.string().max(20_000),
  emotionalWeight: z.string().max(200),
  outcome: z.string().max(200),
  keyTopics: stringList,
}).strict()

const importedPersonContract = z.object({
  name: z.string().trim().min(1).max(500),
  isNew: z.boolean(),
  needsReview: z.boolean(),
  guessedHeadline: z.string().max(2_000).nullable(),
  guessedTags: stringList,
  guessedCloseness: z.number().int().min(1).max(4),
  closenessReason: z.string().max(2_000),
  interactions: z.array(importedInteractionContract).max(10_000),
  matchedPersonId: id.nullable(),
  matchedPersonName: z.string().max(500).nullable(),
}).strict()

export const confirmImportContract = z.object({
  results: z.array(importedPersonContract).min(1).max(5_000),
  fileData: z.object({
    name: z.string().trim().min(1).max(500),
    format: z.string().trim().min(1).max(100),
    content: z.string().max(25_000_000),
  }).strict().optional(),
}).strict()

export const chatMessageContract = z.object({
  message: z.string().trim().min(1).max(50_000),
}).strict()

export const lifeModelClaimFeedbackContract = z.object({
  action: z.enum(["dismiss", "correct"]),
  replacementStatement: z.string().trim().min(1).max(4_000).optional().nullable(),
  reason: z.string().trim().min(1).max(2_000).optional().nullable(),
}).strict().superRefine((value, context) => {
  if (value.action === "correct" && !value.replacementStatement) {
    context.addIssue({ code: "custom", path: ["replacementStatement"], message: "A corrected statement is required." })
  }
  if (value.action === "dismiss" && value.replacementStatement) {
    context.addIssue({ code: "custom", path: ["replacementStatement"], message: "Dismissals cannot include a corrected statement." })
  }
})
export type LifeModelClaimFeedbackInput = z.infer<typeof lifeModelClaimFeedbackContract>

export type ContractIssue = {
  path: string
  message: string
  code: string
}

export function contractIssues(error: z.ZodError): ContractIssue[] {
  return error.issues.map(issue => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }))
}

// ─────────────────────────────────────────────────────────────────────────
// Control plane (docs/adr/0002-graph-event-spine.md)
//
// Published here BEFORE the apps/api backend exists, so Track B can build UI
// against real types instead of hand-rolling shapes that get thrown away once
// the backend lands. Mirrors packages/db/prisma/schema.prisma exactly —
// GraphEvent, GraphEventReceipt, ReviewItem — and stays in sync with it.
// ─────────────────────────────────────────────────────────────────────────

// A reference to any of the eight primitives, Interaction, or another
// supporting model — the same shape used by InteractionParticipant.entityType
// and GraphEvent.subjectType, so one type describes "what this points at"
// everywhere in the graph.
export const entityRefContract = z.object({
  entityType: z.string().trim().min(1).max(64),
  entityId: id,
}).strict()
export type EntityRef = z.infer<typeof entityRefContract>

// Who did something — a user, an API key, the system, or a rule acting under
// its own authority. Mirrors DomainActor (packages/access/index.ts) so the two
// never drift into incompatible shapes.
export const actorRefContract = z.object({
  type: z.enum(["user", "api_key", "system", "rule"]),
  id: z.string().trim().min(1).max(256).nullish(),
  label: z.string().trim().min(1).max(500).nullish(),
  workspaceId: z.string().trim().min(1).max(256).nullish(),
}).strict()
export type ActorRef = z.infer<typeof actorRefContract>

// A pointer back to the raw thing that justified a claim — the Note, sync run,
// or file a derived record traces to. "Provenance is sacred" per the
// manifesto; this is the typed shape that promise takes on the wire.
export const provenanceRefContract = z.object({
  noteId: id.nullish(),
  sourceFileId: id.nullish(),
  syncRunId: z.string().trim().min(1).max(256).nullish(),
  detail: record.nullish(),
}).strict()
export type ProvenanceRef = z.infer<typeof provenanceRefContract>

// One error shape for every route under apps/api and the Persons /api/v1
// forwarding routes, so a client writes one error handler, not one per app.
export const errorEnvelopeContract = z.object({
  error: z.object({
    code: z.string().trim().min(1).max(128),
    message: z.string().trim().min(1).max(2_000),
    details: z.unknown().optional(),
  }).strict(),
}).strict()
export type ErrorEnvelope = z.infer<typeof errorEnvelopeContract>

// Keyset pagination envelope — never offset. See packages/domain's interaction
// stream (moving here in Phase A3) for why: OFFSET N makes the database walk
// and discard N rows before returning anything, so page 100 costs a hundred
// times page 1, while a cursor on (sort key, id) makes every page an index
// seek regardless of depth.
export function cursorPageContract<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative().optional(),
  }).strict()
}

// Standard idempotency header contract: a client-supplied key that makes a
// retried write safe to repeat. Pairs with GraphEvent.idempotencyKey — the
// same value flows from the HTTP header into the event the command publishes.
export const idempotencyKeyContract = z.string().trim().min(1).max(256)

export const reviewItemStatusContract = z.enum([
  "pending", "accepted", "edited_accepted", "dismissed", "superseded", "failed",
])
export type ReviewItemStatus = z.infer<typeof reviewItemStatusContract>

export const reviewItemRiskTierContract = z.enum(["observe", "safe_auto", "review", "confirm"])
export type ReviewItemRiskTier = z.infer<typeof reviewItemRiskTierContract>

// A proposed command, not yet applied. Accepting a ReviewItem means "run this
// command", never "re-derive what to do from the raw content" — the whole
// point of storing the command instead of just the evidence.
export const proposedCommandContract = z.object({
  command: z.string().trim().min(1).max(256),
  input: record,
}).strict()

export const reviewItemContract = z.object({
  id,
  workspaceId: id,
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
  source: z.string().trim().min(1).max(128),
  sourceId: z.string().trim().min(1).max(256),
  itemType: z.string().trim().min(1).max(128),
  proposedCommand: proposedCommandContract,
  targetType: z.string().trim().min(1).max(64).nullable(),
  targetId: id.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidence: record.nullable(),
  riskTier: reviewItemRiskTierContract,
  priority: z.number().int().min(1).max(5),
  status: reviewItemStatusContract,
  resolvedAt: z.union([z.string(), z.date()]).nullable(),
  resolvedBy: z.string().trim().min(1).max(256).nullable(),
  resultType: z.string().trim().min(1).max(64).nullable(),
  resultId: id.nullable(),
}).strict()
export type ReviewItemDTO = z.infer<typeof reviewItemContract>

// The only three ways to resolve a review item. "edit_and_accept" carries a
// patch to proposedCommand.input applied before the command runs — the
// proposal is corrected, not silently trusted or silently thrown away.
export const reviewItemActionContract = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }).strict(),
  z.object({
    action: z.literal("edit_and_accept"),
    input: record,
  }).strict(),
  z.object({
    action: z.literal("dismiss"),
    reason: z.string().trim().min(1).max(2_000).optional(),
  }).strict(),
])
export type ReviewItemAction = z.infer<typeof reviewItemActionContract>

// Batch dismissal is intentionally narrower than single-item review: only
// same-source, same-itemType groups, and only low-risk tiers — never confirm
// or review-tier items, which exist precisely because they need individual
// judgment.
export const reviewItemBulkDismissContract = z.object({
  ids: z.array(id).min(1).max(200),
  reason: z.string().trim().min(1).max(2_000).optional(),
}).strict()

export const graphEventTypeContract = z.string().trim().min(1).max(128)

export const graphEventContract = z.object({
  id,
  workspaceId: id,
  schemaVersion: z.number().int().positive(),
  occurredAt: z.union([z.string(), z.date()]),
  subjectType: z.string().trim().min(1).max(64),
  subjectId: id,
  eventType: graphEventTypeContract,
  actorType: z.enum(["user", "api_key", "system", "rule"]),
  actorId: z.string().trim().min(1).max(256).nullable(),
  sourceConnector: z.string().trim().min(1).max(128).nullable(),
  correlationId: z.string().trim().min(1).max(256).nullable(),
  causationId: id.nullable(),
  causationDepth: z.number().int().min(0),
  payload: record,
  provenance: provenanceRefContract.nullable(),
}).strict()
export type GraphEventDTO = z.infer<typeof graphEventContract>

export { z }
