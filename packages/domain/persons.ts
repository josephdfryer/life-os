import { decodeStoredJson, storedStringList } from "@life-os/contracts"
import { publishGraphEvent, type GraphEventActor } from "./events"
import { writeAuditLog, type AuditActor } from "./audit"

// Extracted from apps/persons/server/domain/persons.ts (Track C, phase C4)
// so Person gets the same shared-command treatment already proven for
// StagedInteraction/Interaction/Rule/Access — and so packages/automation
// can generalize add_tag/remove_tag to call a real command instead of a raw
// Prisma write. Framework-agnostic on purpose: no revalidatePath (Next.js
// cache invalidation is a caller concern, not a domain one) and no
// automation trigger firing (packages/domain never depends on
// packages/automation — the one-directional dependency the rest of this
// package already relies on). Both stay in the Persons app's shim, exactly
// as they did before this move.

export class PersonError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "PersonError"
  }
}

const COLOR_PALETTE = [
  { color: "#8f6b4a", colorSoft: "#f0e6d8" },
  { color: "#2a6ea3", colorSoft: "#e8f1f8" },
  { color: "#3a8a5c", colorSoft: "#e8f4ed" },
  { color: "#7a3aa3", colorSoft: "#f0e8f8" },
  { color: "#a38a3a", colorSoft: "#f8f4e8" },
  { color: "#3a7aa3", colorSoft: "#e8f3f8" },
  { color: "#a33a6e", colorSoft: "#f8e8f1" },
  { color: "#5c8a3a", colorSoft: "#edf4e8" },
]

function assignColor(index: number) {
  return COLOR_PALETTE[index % COLOR_PALETTE.length]
}

export type PersonInput = {
  first?: unknown
  last?: unknown
  nickname?: unknown
  title?: unknown
  headline?: unknown
  company?: unknown
  email?: unknown
  phone?: unknown
  emails?: unknown
  phones?: unknown
  birthday?: unknown
  closeness?: unknown
  tags?: unknown
  values?: unknown
  notes?: unknown
  location?: unknown
  linkedin?: unknown
  twitter?: unknown
  website?: unknown
  facebook?: unknown
  instagram?: unknown
  color?: unknown
  colorSoft?: unknown
}

export async function createPerson(input: PersonInput, workspaceId = "default-workspace", actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const first = requiredFirstName(input.first)
  const last = optionalLastName(input.last)
  const count = await db.person.count({ where: { workspaceId } })
  const assigned = assignColor(count)
  const emailsJson = jsonList(contactList(input.emails, input.email))

  const person = await db.$transaction(async tx => {
    const created = await tx.person.create({
      data: {
        first,
        workspaceId,
        last,
        nickname: optionalString(input.nickname),
        title: optionalString(input.title),
        headline: optionalString(input.headline),
        company: optionalString(input.company),
        emails: emailsJson,
        emailSearch: emailsJson.toLowerCase(),
        phones: jsonList(contactList(input.phones, input.phone)),
        birthday: validatedBirthday(input.birthday),
        closeness: input.closeness === undefined ? 2 : Number(input.closeness) || 2,
        tags: jsonList(optionalStringArray(input.tags)),
        values: jsonList(optionalStringArray(input.values)),
        notes: optionalString(input.notes),
        location: optionalString(input.location),
        linkedin: optionalString(input.linkedin),
        twitter: optionalString(input.twitter),
        website: optionalString(input.website),
        facebook: optionalString(input.facebook),
        instagram: optionalString(input.instagram),
        color: typeof input.color === "string" && input.color ? input.color : assigned.color,
        colorSoft: typeof input.colorSoft === "string" && input.colorSoft ? input.colorSoft : assigned.colorSoft,
      },
    })

    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Person",
      subjectId: created.id,
      eventType: "person.create",
      actor,
      idempotencyKey: `person-create:${created.id}`,
      payload: { first: created.first, last: created.last },
    })

    return created
  })

  await writeAuditLog({ actor, action: "person.create", targetType: "person", targetId: person.id })
  return person
}

export async function updatePerson(id: string, input: PersonInput, workspaceId = "default-workspace", actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const patch: Record<string, unknown> = {}
  if (input.first !== undefined) patch.first = requiredFirstName(input.first)
  if (input.last !== undefined) patch.last = optionalLastName(input.last)
  if (input.nickname !== undefined) patch.nickname = optionalString(input.nickname)
  if (input.title !== undefined) patch.title = optionalString(input.title)
  if (input.headline !== undefined) patch.headline = optionalString(input.headline)
  if (input.company !== undefined) patch.company = optionalString(input.company)
  if (input.emails !== undefined || input.email !== undefined) {
    const emailsJson = jsonList(contactList(input.emails, input.email))
    patch.emails = emailsJson
    patch.emailSearch = emailsJson.toLowerCase()
  }
  if (input.phones !== undefined || input.phone !== undefined) patch.phones = jsonList(contactList(input.phones, input.phone))
  if (input.birthday !== undefined) patch.birthday = validatedBirthday(input.birthday)
  if (input.closeness !== undefined) {
    const closeness = Number(input.closeness)
    if (!Number.isFinite(closeness)) throw new PersonError("closeness must be a number", "validation")
    patch.closeness = closeness
  }
  if (input.tags !== undefined) patch.tags = jsonList(optionalStringArray(input.tags))
  if (input.values !== undefined) patch.values = jsonList(optionalStringArray(input.values))
  if (input.notes !== undefined) patch.notes = optionalString(input.notes)
  if (input.location !== undefined) patch.location = optionalString(input.location)
  if (input.linkedin !== undefined) patch.linkedin = optionalString(input.linkedin)
  if (input.twitter !== undefined) patch.twitter = optionalString(input.twitter)
  if (input.website !== undefined) patch.website = optionalString(input.website)
  if (input.facebook !== undefined) patch.facebook = optionalString(input.facebook)
  if (input.instagram !== undefined) patch.instagram = optionalString(input.instagram)

  const existing = await db.person.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw new PersonError("Person not found", "not_found")

  const person = await db.$transaction(async tx => {
    const updated = await tx.person.update({ where: { id }, data: patch })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Person",
      subjectId: id,
      eventType: "person.update",
      actor,
      idempotencyKey: `person-update:${id}:${Date.now()}`,
      payload: { fields: Object.keys(patch) },
    })
    return updated
  })

  await writeAuditLog({ actor, action: "person.update", targetType: "person", targetId: id, metadata: { fields: Object.keys(patch) } })
  return person
}

export async function deletePerson(id: string, workspaceId = "default-workspace", actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.person.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw new PersonError("Person not found", "not_found")

  await db.$transaction(async tx => {
    await tx.person.delete({ where: { id } })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Person",
      subjectId: id,
      eventType: "person.delete",
      actor,
      idempotencyKey: `person-delete:${id}`,
      payload: {},
    })
  })

  await writeAuditLog({ actor, action: "person.delete", targetType: "person", targetId: id })
}

/**
 * Set a Person's full tag list — the write side of the automation
 * add_tag/remove_tag actions (packages/automation/actions.ts), which compute
 * the next array themselves (add/remove is a read-then-decide concern that
 * belongs in automation, not baked into this generic setter) and call this
 * to persist it.
 */
export async function setPersonTags(id: string, tags: string[], workspaceId = "default-workspace", actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.person.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw new PersonError("Person not found", "not_found")

  const person = await db.$transaction(async tx => {
    const updated = await tx.person.update({ where: { id }, data: { tags: JSON.stringify(tags) } })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Person",
      subjectId: id,
      eventType: "person.tags_set",
      actor,
      idempotencyKey: `person-tags-set:${id}:${Date.now()}`,
      payload: { tags },
    })
    return updated
  })

  await writeAuditLog({ actor, action: "person.tags_set", targetType: "person", targetId: id, metadata: { tags } })
  return person
}

export async function getPersonTags(id: string, workspaceId = "default-workspace"): Promise<string[] | null> {
  const { db } = await import("@life-os/db")
  const person = await db.person.findFirst({ where: { id, workspaceId }, select: { tags: true } })
  if (!person) return null
  return decodeStoredJson(person.tags, storedStringList, "Person.tags", [])
}

function contactList(arrayValue: unknown, singleValue: unknown) {
  const fromArray = optionalStringArray(arrayValue)
  if (fromArray.length) return fromArray
  const single = optionalString(singleValue)
  return single ? [single] : []
}

function validatedBirthday(value: unknown) {
  const raw = optionalString(value)
  if (!raw) return null
  const birthday = normalizeBirthday(raw)
  if (!birthday) throw new PersonError("birthday must be YYYY-MM-DD or MM-DD", "validation")
  return birthday
}

// Ported as-is from apps/persons/lib/birthday.ts's normalizeBirthday —
// self-contained, no app dependency, safe to duplicate rather than share
// via a new package for one function. Keep in sync if either changes.
function normalizeBirthday(value: unknown): string | null {
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (!raw) return null

  const normalized = raw.replace(/^0000-/, "--")
  const partial = normalized.match(/^--(\d{2})-?(\d{2})$/)
    ?? normalized.match(/^(\d{2})-(\d{2})$/)
    ?? normalized.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (partial) return validMonthDay(partial[1], partial[2])

  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return validFullDate(iso[1], iso[2], iso[3])

  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return validFullDate(compact[1], compact[2], compact[3])

  const slash = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) return validFullDate(slash[3], slash[1], slash[2])

  const words = normalized.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (words) {
    const month = MONTHS[words[2].toLowerCase()]
    if (month) return validFullDate(words[3], month, words[1])
  }

  return null
}

function validMonthDay(monthRaw: string, dayRaw: string) {
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const referenceYear = month === 2 && day === 29 ? 2024 : 2023
  const date = new Date(referenceYear, month - 1, day)
  if (date.getMonth() + 1 !== month || date.getDate() !== day) return null
  return `--${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function validFullDate(yearRaw: string, monthRaw: string, dayRaw: string) {
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (!Number.isInteger(year) || year < 1) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
}

function requiredFirstName(value: unknown): string {
  return requiredString(value, "first")
}

function optionalLastName(value: unknown): string {
  return optionalString(value) ?? ""
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PersonError(`${field} is required`, "validation")
  return value.trim()
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function jsonList(value: string[]) {
  return JSON.stringify(value)
}
