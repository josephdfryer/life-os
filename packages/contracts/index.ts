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

// apps/api's canonical /v1/rules — wire shapes for packages/automation's
// rules.ts commands. mode/status stay loose strings rather than an enum: the
// domain layer itself only validates non-emptiness (requiredString), and a
// contract stricter than the domain it fronts would reject values the
// engine already accepts.
export const ruleInputContract = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  trigger: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(50).optional(),
  priority: z.number().int().min(0).max(100_000).optional(),
  mode: z.string().trim().min(1).max(50).optional(),
  conditions: ruleConditionsContract.optional(),
  actions: ruleActionsContract.optional(),
  stopProcessing: z.boolean().optional(),
}).strict()
export const ruleUpdateContract = ruleInputContract.partial()

export const ruleTestInputContract = z.object({
  ruleId: id.nullable().optional(),
  rule: ruleInputContract.partial().optional(),
  payload: record.optional(),
  targetType: z.string().trim().max(200).nullable().optional(),
  targetId: z.string().trim().max(256).nullable().optional(),
}).strict()

export const ruleResourceContract = z.object({
  id,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  name: z.string(),
  description: z.string().nullable(),
  trigger: z.string(),
  status: z.string(),
  priority: z.number(),
  mode: z.string(),
  conditions: ruleConditionsContract,
  actions: ruleActionsContract,
  stopProcessing: z.boolean(),
  version: z.number().int(),
  createdByUser: z.object({ id, email: z.string(), name: z.string().nullable() }).strict().nullable(),
  lastRun: z.object({
    createdAt: z.string().datetime({ offset: true }),
    matched: z.boolean(),
    status: z.string(),
    message: z.string().nullable(),
  }).strict().nullable(),
}).strict()
export type RuleResource = z.infer<typeof ruleResourceContract>

export const rulesListContract = z.object({
  rules: z.array(ruleResourceContract),
  runCount: z.number().int(),
}).strict()

export const ruleRunResourceContract = z.object({
  id,
  ruleId: id,
  ruleVersion: z.number().int(),
  trigger: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  matched: z.boolean(),
  mode: z.string(),
  status: z.string(),
  input: z.unknown().nullable(),
  actionsPlanned: z.unknown().nullable(),
  actionsApplied: z.unknown().nullable(),
  message: z.string().nullable(),
  causationDepth: z.number().int(),
  createdAt: z.string().datetime({ offset: true }),
}).strict()

export const ruleTestResultContract = z.object({
  matched: z.boolean(),
  actionsPlanned: ruleActionsContract,
  message: z.string(),
  run: ruleRunResourceContract.nullable(),
}).strict()

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
    // Provenance for PersonCard's source badge — "vcard" | "csv" |
    // "spreadsheet" | "gmail_contacts", set by the caller per import batch.
    source: z.string().trim().max(40).optional().nullable(),
  }).passthrough()).min(1).max(500),
}).strict()

export const bulkUpdatePeopleContract = z.object({
  updates: z.array(z.object({ id, fields: record }).strict()).min(1).max(200),
}).strict()

export const approvedEmailContract = z.object({
  email: z.email().max(320),
  workspaceId: id.optional().nullable(),
  roleId: id.optional().nullable(),
}).strict()

export const updateApprovedEmailContract = z.object({
  status: z.enum(["approved", "revoked"]).optional(),
  roleId: id.optional().nullable(),
}).strict().refine(value => value.status !== undefined || value.roleId !== undefined, {
  message: "At least one approved-email field is required.",
})

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
  fileIds: z.array(z.string().trim().min(1)).max(10).optional().default([]),
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

// Canonical People API contracts. These are intentionally narrower than the
// Prisma Person row: search-only fields and workspace ownership never become
// part of the public resource shape. A native client can render a profile from
// this contract and load its timeline separately from /v1/stream?personId=...
// without depending on apps/persons internals.
const nullableText = z.string().max(20_000).nullable()
const personFieldsContract = z.object({
  first: z.string().trim().min(1).max(200),
  last: z.string().trim().max(200).optional().nullable(),
  nickname: z.string().trim().max(200).optional().nullable(),
  title: z.string().trim().max(500).optional().nullable(),
  headline: z.string().trim().max(2_000).optional().nullable(),
  company: z.string().trim().max(500).optional().nullable(),
  emails: z.array(z.string().trim().min(1).max(512)).max(500).optional(),
  phones: z.array(z.string().trim().min(1).max(100)).max(500).optional(),
  birthday: z.string().trim().max(32).optional().nullable(),
  closeness: z.number().int().min(1).max(4).optional(),
  tags: stringList.optional(),
  values: stringList.optional(),
  notes: nullableText.optional(),
  location: z.string().trim().max(2_000).optional().nullable(),
  linkedin: z.string().trim().max(2_000).optional().nullable(),
  twitter: z.string().trim().max(2_000).optional().nullable(),
  website: z.string().trim().max(2_000).optional().nullable(),
  facebook: z.string().trim().max(2_000).optional().nullable(),
  instagram: z.string().trim().max(2_000).optional().nullable(),
  color: z.string().trim().max(64).optional().nullable(),
  colorSoft: z.string().trim().max(64).optional().nullable(),
}).strict()

export const personCreateContract = personFieldsContract
export type PersonCreateInput = z.infer<typeof personCreateContract>

export const personUpdateContract = personFieldsContract.partial().refine(
  value => Object.keys(value).length > 0,
  { message: "At least one field is required." },
)
export type PersonUpdateInput = z.infer<typeof personUpdateContract>

export const personResourceContract = z.object({
  id,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  first: z.string(),
  last: z.string(),
  nickname: z.string().nullable(),
  title: z.string().nullable(),
  headline: z.string().nullable(),
  company: z.string().nullable(),
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  birthday: z.string().nullable(),
  closeness: z.number().int(),
  tags: z.array(z.string()),
  values: z.array(z.string()),
  notes: z.string().nullable(),
  location: z.string().nullable(),
  linkedin: z.string().nullable(),
  twitter: z.string().nullable(),
  website: z.string().nullable(),
  facebook: z.string().nullable(),
  instagram: z.string().nullable(),
  color: z.string().nullable(),
  colorSoft: z.string().nullable(),
}).strict()
export type PersonResource = z.infer<typeof personResourceContract>

export const peoplePageContract = cursorPageContract(personResourceContract)
export type PeoplePage = z.infer<typeof peoplePageContract>

// GET /v1/people/attention — people whose declared cadence has lapsed, most
// overdue first. Computed from @life-os/alignment on every call, never stored;
// the same numbers Persons' "needs attention" filter and Home's nudges use.
export const attentionItemContract = z.object({
  personId: z.string(),
  first: z.string(),
  last: z.string(),
  closeness: z.number().int(),
  score: z.number().nonnegative(),
  cadenceDays: z.number().int().positive().nullable(),
  lastInteractionAt: z.string().datetime({ offset: true }).nullable(),
  lastInteractionSummary: z.string().nullable(),
  daysSinceLast: z.number().int().nonnegative().nullable(),
  daysOverdue: z.number().int().nonnegative(),
  hasActivePlan: z.boolean(),
  suggestedAction: z.enum(["first_touch", "reach_out", "follow_up_plan"]),
}).strict()
export type AttentionItem = z.infer<typeof attentionItemContract>

export const attentionQueueContract = z.object({
  data: z.array(attentionItemContract),
  limit: z.number().int().positive(),
  generatedAt: z.string().datetime({ offset: true }),
}).strict()
export type AttentionQueue = z.infer<typeof attentionQueueContract>

const interactionMutableFieldsContract = z.object({
  duration: z.number().int().nonnegative().optional().nullable(),
  summary: nullableText.optional(),
  notes: nullableText.optional(),
  emotionalWeight: z.string().trim().max(500).optional().nullable(),
  outcome: z.string().trim().max(2_000).optional().nullable(),
  actionItems: z.array(z.string().trim().min(1).max(2_000)).max(500).optional().nullable(),
  billable: z.boolean().optional(),
  amountCents: z.number().int().safe().optional().nullable(),
  direction: z.string().trim().max(100).optional().nullable(),
}).strict()

export const interactionCreateContract = interactionMutableFieldsContract.extend({
  personId: id.optional().nullable(),
  eventId: id.optional().nullable(),
  sourceFileId: id.optional().nullable(),
  type: z.string().trim().min(1).max(200),
  timestamp: z.iso.datetime().optional(),
}).strict()
export type InteractionCreateInput = z.infer<typeof interactionCreateContract>

export const interactionUpdateContract = interactionMutableFieldsContract.partial().refine(
  value => Object.keys(value).length > 0,
  { message: "At least one field is required." },
)
export type InteractionUpdateInput = z.infer<typeof interactionUpdateContract>

export const interactionResourceContract = z.object({
  id,
  createdAt: z.iso.datetime(),
  personId: id.nullable(),
  eventId: id.nullable(),
  type: z.string(),
  timestamp: z.iso.datetime(),
  duration: z.number().int().nullable(),
  emotionalWeight: z.string().nullable(),
  outcome: z.string().nullable(),
  summary: z.string().nullable(),
  notes: z.string().nullable(),
  actionItems: z.array(z.string()),
  billable: z.boolean(),
  amountCents: z.number().int().nullable(),
  direction: z.string().nullable(),
  sourceFileId: id.nullable(),
  source: z.string().nullable(),
  sourceId: z.string().nullable(),
  subtype: z.string().nullable(),
  currency: z.string(),
  category: z.string().nullable(),
  merchantName: z.string().nullable(),
  actorPersonId: id.nullable(),
  sourceNoteId: id.nullable(),
  metadata: z.unknown().nullable(),
  event: z.object({ id, name: z.string(), type: z.string() }).strict().nullable(),
  file: z.object({ id, filename: z.string(), retrieveUrl: z.string() }).strict().nullable(),
}).strict()
export type InteractionResource = z.infer<typeof interactionResourceContract>

export const planStatusContract = z.enum(["draft", "active", "blocked", "completed", "abandoned"])

const planFieldsContract = z.object({
  personId: id.optional().nullable(),
  text: z.string().trim().min(1).max(20_000),
  timescale: z.string().trim().max(500).optional().nullable(),
  successSignals: z.array(z.string().trim().min(1).max(2_000)).max(500).optional().nullable(),
  parentId: id.optional().nullable(),
  status: planStatusContract.optional(),
}).strict()

export const planCreateContract = planFieldsContract
export type PlanCreateInput = z.infer<typeof planCreateContract>

export const planUpdateContract = planFieldsContract.partial().refine(
  value => Object.keys(value).length > 0,
  { message: "At least one field is required." },
)
export type PlanUpdateInput = z.infer<typeof planUpdateContract>

export const planResourceContract = z.object({
  id,
  createdAt: z.iso.datetime(),
  personId: id.nullable(),
  text: z.string(),
  timescale: z.string().nullable(),
  successSignals: z.array(z.string()),
  status: planStatusContract,
  dueOn: z.iso.datetime().nullable(),
  deferCount: z.number().int().nonnegative(),
  completedAt: z.iso.datetime().nullable(),
  parentId: id.nullable(),
  scheduledStart: z.iso.datetime().nullable(),
  scheduledEnd: z.iso.datetime().nullable(),
  placeId: id.nullable(),
  externalSource: z.string().nullable(),
  externalInstanceId: z.string().nullable(),
  reconciliationStatus: z.string().nullable(),
  reconciledAt: z.iso.datetime().nullable(),
  sourceNoteId: id.nullable(),
}).strict()
export type PlanResource = z.infer<typeof planResourceContract>

export const plansPageContract = cursorPageContract(planResourceContract)
export type PlansPage = z.infer<typeof plansPageContract>

export const noteTypeContract = z.enum([
  "thought",
  "observation",
  "declaration",
  "voice_transcript",
  "import",
  "theory_observation",
])

const noteSubjectContract = z.object({
  aboutPersonId: id.nullable().optional(),
  aboutPlaceId: id.nullable().optional(),
  aboutItemId: id.nullable().optional(),
  aboutEventId: id.nullable().optional(),
  aboutPlanId: id.nullable().optional(),
  aboutGroupId: id.nullable().optional(),
  aboutStateId: id.nullable().optional(),
})

export const noteCreateContract = noteSubjectContract.extend({
  content: z.string().trim().min(1).max(10_000),
  type: noteTypeContract.optional(),
  timestamp: z.iso.datetime().optional(),
  idempotencyKey: z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9_-]+$/).optional().nullable(),
  metadata: record.nullable().optional(),
  source: z.string().trim().min(1).max(200).optional(),
}).strict()
export type NoteCreateInput = z.infer<typeof noteCreateContract>

export const noteResourceContract = z.object({
  id,
  createdAt: z.iso.datetime(),
  timestamp: z.iso.datetime(),
  type: z.string(),
  content: z.string(),
  metadata: z.unknown().nullable(),
  sourceFileId: id.nullable(),
  aboutPersonId: id.nullable(),
  aboutPlaceId: id.nullable(),
  aboutItemId: id.nullable(),
  aboutEventId: id.nullable(),
  aboutPlanId: id.nullable(),
  aboutGroupId: id.nullable(),
  aboutStateId: id.nullable(),
}).strict()
export type NoteResource = z.infer<typeof noteResourceContract>

export const notesPageContract = cursorPageContract(noteResourceContract)
export type NotesPage = z.infer<typeof notesPageContract>

// apps/api's canonical /v1/events — the Event *primitive* (a calendar/
// meeting occurrence), not the GraphEvent ledger. See
// packages/domain/event-primitive.ts for why the domain module isn't named
// events.ts, and packages/access's life-events.read/write scopes for why
// this resource doesn't reuse the already-seeded events.read scope.
const eventFieldsContract = z.object({
  name: z.string().trim().min(1).max(500),
  type: z.string().trim().min(1).max(200),
  timestamp: z.iso.datetime().optional(),
  end: z.iso.datetime().nullable().optional(),
  placeId: id.nullable().optional(),
  notes: z.string().trim().max(20_000).nullable().optional(),
  transcript: z.string().trim().max(200_000).nullable().optional(),
  metadata: record.nullable().optional(),
}).strict()

export const eventCreateContract = eventFieldsContract
export type EventCreateInput = z.infer<typeof eventCreateContract>

export const eventUpdateContract = eventFieldsContract.partial().refine(
  value => Object.keys(value).length > 0,
  { message: "At least one field is required." },
)
export type EventUpdateInput = z.infer<typeof eventUpdateContract>

export const eventResourceContract = z.object({
  id,
  createdAt: z.iso.datetime(),
  name: z.string(),
  type: z.string(),
  start: z.iso.datetime(),
  end: z.iso.datetime().nullable(),
  timestamp: z.iso.datetime(),
  placeId: id.nullable(),
  notes: z.string().nullable(),
  transcript: z.string().nullable(),
  metadata: z.unknown().nullable(),
  sourcePlanId: id.nullable(),
  parentEventId: id.nullable(),
  sourceNoteId: id.nullable(),
}).strict()
export type EventResource = z.infer<typeof eventResourceContract>

export const eventsPageContract = cursorPageContract(eventResourceContract)
export type EventsPage = z.infer<typeof eventsPageContract>

export const auditLogResourceContract = z.object({
  id,
  createdAt: z.iso.datetime(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  actorLabel: z.string().nullable(),
  metadata: z.unknown().nullable(),
  user: z.object({ id, email: z.string(), name: z.string().nullable() }).strict().nullable(),
  apiKey: z.object({ id, name: z.string(), keyPrefix: z.string() }).strict().nullable(),
  person: z.object({ id, first: z.string(), last: z.string() }).strict().nullable(),
}).strict()
export type AuditLogResource = z.infer<typeof auditLogResourceContract>

export const auditLogPageContract = cursorPageContract(auditLogResourceContract)
export type AuditLogPage = z.infer<typeof auditLogPageContract>

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

// Common list response for graph entities. Individual routes may expose richer
// fields, but every paginated row has a stable id and every page advertises how
// to continue without making clients infer truncation from the row count.
export const entityCursorPageContract = cursorPageContract(z.object({
  id,
}).passthrough())
export type EntityCursorPage = z.infer<typeof entityCursorPageContract>

// Standard idempotency header contract: a client-supplied key that makes a
// retried write safe to repeat. Pairs with GraphEvent.idempotencyKey — the
// same value flows from the HTTP header into the event the command publishes.
export const idempotencyKeyContract = z.string().trim().min(1).max(256)

// Native companion protocol. These records are intentionally normalized and
// bounded: source database rows, file paths, attachments, audio, raw GPS
// pings, and granular HealthKit samples are not valid wire payloads.
export const devicePlatformContract = z.enum(["macos", "ios"])
export const deviceSourceContract = z.enum([
  "imessage", "whatsapp", "call_history", "healthkit", "location",
  "photos", "voice_journal", "documents", "contacts", "calendar", "facebook", "google_contacts",
])
export const deviceScopeContract = z.enum(["device.ingest", "device.heartbeat", "device.self", "workout.read", "workout.write"])

const healthMetricContract = z.object({
  key: z.string().trim().min(1).max(128),
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(64).optional(),
}).strict()

const deviceRecordContract = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("health.daily"),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    metrics: z.array(healthMetricContract).min(1).max(512),
  }).strict(),
  z.object({
    type: z.literal("health.workout"),
    workoutType: z.string().trim().min(1).max(128),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
    durationSeconds: z.number().nonnegative().max(604_800).nullable(),
    energyKcal: z.number().nonnegative().max(100_000).nullable(),
    distanceMeters: z.number().nonnegative().max(10_000_000).nullable(),
  }).strict(),
  z.object({
    type: z.literal("location.visit"),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    horizontalAccuracyMeters: z.number().nonnegative().max(100_000),
    placeName: z.string().trim().min(1).max(500).nullable(),
  }).strict(),
  z.object({
    type: z.literal("communication.message"),
    channel: z.enum(["imessage", "whatsapp", "call"]),
    direction: z.enum(["incoming", "outgoing", "missed"]),
    contactName: z.string().trim().min(1).max(500).nullable(),
    contactHandle: z.string().trim().min(1).max(500).nullable(),
    text: z.string().max(50_000).nullable(),
    durationSeconds: z.number().nonnegative().max(604_800).nullable(),
  }).strict(),
  z.object({
    type: z.literal("document.metadata"),
    filename: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(256).nullable(),
    sizeBytes: z.number().int().nonnegative().max(10_000_000_000),
    checksum: z.string().trim().min(16).max(256),
    extractedText: z.string().max(100_000).nullable(),
  }).strict(),
  z.object({
    type: z.literal("photo.metadata"),
    capturedAt: z.string().datetime({ offset: true }),
    mediaType: z.enum(["photo", "video"]),
    favorite: z.boolean(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    caption: z.string().max(10_000).nullable(),
  }).strict(),
  z.object({
    type: z.literal("voice.transcript"),
    recordedAt: z.string().datetime({ offset: true }),
    durationSeconds: z.number().nonnegative().max(604_800).nullable(),
    transcript: z.string().trim().min(1).max(100_000),
  }).strict(),
  z.object({
    type: z.literal("contact.person"),
    givenName: z.string().trim().max(200).nullable(),
    familyName: z.string().trim().max(200).nullable(),
    organizationName: z.string().trim().max(300).nullable(),
    jobTitle: z.string().trim().max(300).nullable(),
    emails: z.array(z.string().trim().max(320)).max(20),
    phones: z.array(z.string().trim().max(64)).max(20),
    // Optional enriched fields from social / calendar sources
    profileUrl: z.string().trim().url().max(500).nullish(),
    hometown: z.string().trim().max(300).nullish(),
    location: z.string().trim().max(300).nullish(),
    birthday: z.string().trim().max(20).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  }).strict(),
])
export { deviceRecordContract }
export type DeviceRecord = z.infer<typeof deviceRecordContract>

export const deviceIngestItemContract = z.object({
  deviceId: id,
  source: deviceSourceContract,
  sourceId: z.string().trim().min(1).max(512),
  schemaVersion: z.literal(1),
  observedAt: z.string().datetime({ offset: true }),
  record: deviceRecordContract,
}).strict().superRefine((item, context) => {
  const expectedSource: Record<DeviceRecord["type"], z.infer<typeof deviceSourceContract>> = {
    "health.daily": "healthkit", "health.workout": "healthkit", "location.visit": "location",
    "communication.message": item.record.type === "communication.message" ? ({ imessage: "imessage", whatsapp: "whatsapp", call: "call_history" } as const)[item.record.channel] : "imessage",
    "document.metadata": "documents", "photo.metadata": "photos", "voice.transcript": "voice_journal",
    "contact.person": (["contacts", "calendar", "facebook", "google_contacts"] as const).includes(item.source as never) ? item.source as never : "contacts",
  }
  if (item.source !== expectedSource[item.record.type]) context.addIssue({ code: "custom", path: ["source"], message: "source does not match normalized record type" })
  if (item.record.type === "health.daily") {
    const keys = item.record.metrics.map(metric => metric.key)
    if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["record", "metrics"], message: "health metric keys must be unique within a day" })
  }
})
export type DeviceIngestItemInput = z.infer<typeof deviceIngestItemContract>

export const deviceIngestBatchContract = z.object({
  batchId: z.string().trim().min(1).max(256),
  schemaVersion: z.literal(1),
  items: z.array(deviceIngestItemContract).min(1).max(200),
}).strict()
export type DeviceIngestBatchInput = z.infer<typeof deviceIngestBatchContract>

export const deviceIngestResultContract = z.object({
  sourceId: z.string(),
  status: z.enum(["accepted", "duplicate", "retryable", "rejected"]),
  resultType: z.string().nullable(),
  resultId: z.string().nullable(),
  errorCode: z.string().nullable(),
}).strict()

export const deviceHeartbeatContract = z.object({
  appVersion: z.string().trim().min(1).max(64),
  sources: z.array(z.object({
    source: deviceSourceContract,
    enabled: z.boolean(),
    permissionStatus: z.enum(["unknown", "not_requested", "granted", "limited", "denied", "revoked", "unsupported"]),
    healthStatus: z.enum(["unknown", "healthy", "paused", "degraded", "error", "unsupported"]),
    // Optional as well as nullable: Swift JSONEncoder omits nils on some paths
    // and may include a computed `id`. Strip extras; do not 400 the phone.
    lastSuccessAt: z.string().datetime({ offset: true }).nullable().optional(),
    lastErrorCode: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,127}$/).nullable().optional(),
    schemaVersion: z.literal(1),
  })).max(32),
}).strict()

export const deviceExchangeContract = z.object({
  code: z.string().trim().min(1).max(512),
  codeVerifier: z.string().trim().min(43).max(128),
  deviceId: id,
}).strict()

export const deviceRefreshContract = z.object({
  refreshToken: z.string().trim().min(1).max(512),
}).strict()

// Level Up workout device protocol. Web server actions and native device
// routes call identical @life-os/level-up commands — these contracts
// validate the wire shape both directions.
// See docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md "Public interfaces and persistence".

export const workoutPreparedExerciseContract = z.object({
  id, key: z.string(), label: z.string(), modality: z.string(), catalogKey: z.string().nullable(),
  defaultRestSec: z.number().int().nonnegative(), jointLoad: z.array(z.string()),
}).strict()

export const workoutPreparedEntryContract = z.object({
  entryId: id,
  order: z.number().int(),
  exercise: workoutPreparedExerciseContract,
  substitutedFor: z.string().nullable(),
  targetSets: z.number().int(),
  targetReps: z.number().int().nullable(),
  targetLoadKg: z.number().nullable(),
  targetDurationSec: z.number().int().nullable(),
  restSec: z.number().int(),
  lastLoadKg: z.number().nullable(),
  lastReps: z.number().int().nullable(),
  lastDurationSec: z.number().int().nullable(),
  lastIsBodyweight: z.boolean(),
}).strict()

export const workoutReadinessBandContract = z.enum(["full", "adjust", "recover"])

export const workoutReadinessSnapshotContract = z.object({
  localDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  engineVersion: z.string(),
  ruleSetVersion: z.string(),
  inputs: record,
  formSignal: record.nullable(),
  band: workoutReadinessBandContract,
  originalPrescriptionHash: z.string().nullable().optional(),
  suggestedPrescriptionHash: z.string().nullable().optional(),
  reasonCodes: z.array(z.string()).optional(),
}).strict()

export const workoutTodayBundleContract = z.object({
  programDayId: id,
  dayName: z.string(),
  entries: z.array(workoutPreparedEntryContract),
  profile: z.object({
    bodyweightKg: z.number().nullable(),
    unit: z.enum(["kg", "lb"]),
    microPlates: z.boolean(),
  }).strict(),
  readiness: workoutReadinessSnapshotContract,
}).strict()

export const workoutStartSessionContract = z.object({
  programDayId: id.nullable(),
  kneeFlare: z.boolean(),
  lumbarFlare: z.boolean(),
  sourceId: idempotencyKeyContract.optional(),
}).strict()

export const workoutSessionResultContract = z.object({
  id,
  startedAt: z.string().datetime({ offset: true }),
  duplicate: z.boolean(),
}).strict()

export const workoutCompleteSessionContract = z.object({
  sessionId: id,
  sessionRpe: z.number().min(0).max(10).nullable().optional(),
}).strict()

export const workoutLogSetContract = z.object({
  sessionId: id,
  exerciseId: id,
  exerciseKey: z.string().trim().min(1).max(200),
  catalogKey: z.string().trim().min(1).max(200).nullable(),
  setIndex: z.number().int().nonnegative().max(1000),
  reps: z.number().int().nonnegative().max(1000),
  loadKg: z.number().min(0).max(2000),
  durationSec: z.number().int().nonnegative().max(604_800).nullable(),
  isBodyweight: z.boolean(),
  bodyweightKg: z.number().min(0).max(500).nullable(),
  sourceId: idempotencyKeyContract.optional(),
}).strict()

export const workoutLoggedSetContract = z.object({
  id,
  rank: z.number().nullable(),
  rankLetter: z.string().nullable(),
  balance: z.number().nullable(),
  balanceLabel: z.string().nullable(),
  suppressedRankReason: z.string().nullable(),
  isPr: z.boolean(),
  e1rm: z.number().nullable(),
  duplicate: z.boolean(),
}).strict()

export const workoutBodyMetricContract = z.object({
  weightKg: z.number().min(0).max(500).nullable(),
  bodyFatPct: z.number().min(0).max(100).nullable(),
  musclePct: z.number().min(0).max(100).nullable(),
}).strict()

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

export const reviewItemBulkAcceptContract = z.object({
  ids: z.array(id).min(1).max(200),
}).strict()

// Resolving a whole place at once: the selector identifies which pending visits
// are covered, and refusing an empty selector is what stops "accept" from
// meaning "accept every staged visit in the workspace".
export const stagedVisitGroupResolveContract = z.object({
  googlePlaceId: z.string().trim().min(1).max(255).nullish(),
  placeName: z.string().trim().min(1).max(255).nullish(),
  placeAddress: z.string().trim().min(1).max(500).nullish(),
  action: z.enum(["accept", "dismiss"]),
}).strict().refine(
  value => Boolean(value.googlePlaceId || value.placeName || value.placeAddress),
  { message: "A place selector is required" },
)

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
