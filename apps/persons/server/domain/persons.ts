import { revalidatePath } from "next/cache"
import { badRequest, notFound } from "@/server/api/errors"
import type { DomainActor } from "./audit"
import { runRulesForTarget } from "./rules"
import { formatPerson } from "./dto"
import {
  createPerson as sharedCreatePerson,
  updatePerson as sharedUpdatePerson,
  deletePerson as sharedDeletePerson,
  setPersonTags as sharedSetPersonTags,
  getPersonTags as sharedGetPersonTags,
  PersonError,
  type PersonInput,
} from "@life-os/domain"

export type { PersonInput }

// Write operations moved to @life-os/domain/persons.ts (Track C, phase C4)
// so apps/api can expose them without depending on apps/persons/server —
// same shim pattern as apps/persons/server/domain/rules.ts and access.ts.
// This file keeps two things the shared command deliberately doesn't know
// about: Next.js cache revalidation, and firing the person.create/
// person.update automation triggers (packages/domain never depends on
// packages/automation).

export function revalidatePersonsCache(_workspaceId: string) {
  revalidatePath("/people")
}

function translate<T>(promise: Promise<T>): Promise<T> {
  return promise.catch(error => {
    if (error instanceof PersonError) throw error.code === "not_found" ? notFound(error.message) : badRequest(error.message)
    throw error
  })
}

export async function createPerson(input: PersonInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const person = await translate(sharedCreatePerson(input, workspaceId, actor))
  revalidatePersonsCache(workspaceId)
  await runRulesForTarget({
    trigger: "person.create",
    targetType: "person",
    targetId: person.id,
    payload: { personId: person.id, first: person.first, last: person.last },
    actor,
  })
  return formatPerson(person)
}

export async function updatePerson(id: string, input: PersonInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const person = await translate(sharedUpdatePerson(id, input, workspaceId, actor))
  revalidatePersonsCache(workspaceId)
  await runRulesForTarget({
    trigger: "person.update",
    targetType: "person",
    targetId: id,
    payload: { personId: id, fields: Object.keys(input) },
    actor,
  })
  return formatPerson(person)
}

export async function deletePerson(id: string, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  await translate(sharedDeletePerson(id, workspaceId, actor))
  revalidatePersonsCache(workspaceId)
}

export async function setPersonTags(id: string, tags: string[], actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  return formatPerson(await translate(sharedSetPersonTags(id, tags, workspaceId, actor)))
}

export function getPersonTags(id: string, workspaceId?: string) {
  return sharedGetPersonTags(id, workspaceId)
}
