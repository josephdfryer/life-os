import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { assignColor } from "@/lib/colors"
import { badRequest, notFound, optionalString, optionalStringArray, requiredString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import { formatPerson, jsonList } from "./dto"
import { normalizeBirthday } from "@/lib/birthday"

export function revalidatePeopleCache(_workspaceId: string) {
  revalidatePath("/people")
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
  color?: unknown
  colorSoft?: unknown
}

export async function createPerson(input: PersonInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const first = requiredString(input.first, "first")
  const last = requiredString(input.last, "last")
  const count = await db.person.count({ where: { workspaceId } })
  const assigned = assignColor(count)

  const emailsJson = jsonList(contactList(input.emails, input.email))
  const person = await db.person.create({
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
      color: typeof input.color === "string" && input.color ? input.color : assigned.color,
      colorSoft: typeof input.colorSoft === "string" && input.colorSoft ? input.colorSoft : assigned.colorSoft,
    },
  })

  await auditAction({ actor, action: "person.create", targetType: "person", targetId: person.id })
  revalidatePeopleCache(workspaceId)
  return formatPerson(person)
}

export async function updatePerson(id: string, input: PersonInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const patch: Record<string, unknown> = {}
  if (input.first !== undefined) patch.first = requiredString(input.first, "first")
  if (input.last !== undefined) patch.last = requiredString(input.last, "last")
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
    if (!Number.isFinite(closeness)) throw badRequest("closeness must be a number", { field: "closeness" })
    patch.closeness = closeness
  }
  if (input.tags !== undefined) patch.tags = jsonList(optionalStringArray(input.tags))
  if (input.values !== undefined) patch.values = jsonList(optionalStringArray(input.values))
  if (input.notes !== undefined) patch.notes = optionalString(input.notes)
  if (input.location !== undefined) patch.location = optionalString(input.location)
  if (input.linkedin !== undefined) patch.linkedin = optionalString(input.linkedin)
  if (input.twitter !== undefined) patch.twitter = optionalString(input.twitter)
  if (input.website !== undefined) patch.website = optionalString(input.website)

  const existing = await db.person.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw notFound("Person not found", { id })

  const person = await db.person.update({ where: { id }, data: patch })
  await auditAction({ actor, action: "person.update", targetType: "person", targetId: id, metadata: { fields: Object.keys(patch) } })
  revalidatePeopleCache(workspaceId)
  return formatPerson(person)
}

export async function deletePerson(id: string, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const existing = await db.person.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw notFound("Person not found", { id })
  await db.person.delete({ where: { id } })
  await auditAction({ actor, action: "person.delete", targetType: "person", targetId: id })
  revalidatePeopleCache(workspaceId)
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
  if (!birthday) {
    throw badRequest("birthday must be YYYY-MM-DD or MM-DD", { field: "birthday" })
  }
  return birthday
}
