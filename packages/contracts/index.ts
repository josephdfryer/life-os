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

export { z }
