import type { PrismaClient } from "@life-os/db"
import { normalizePhoneDigits, phoneNumbersMatch } from "@life-os/db"
import type { Extraction, ResolvedExtraction, ResolvedParticipant, TriagedItem } from "./types"

const WORKSPACE_ID = process.env.SYNTHESIS_WORKSPACE_ID ?? "default-workspace"

export async function resolveExtraction(
  item: TriagedItem,
  extraction: Extraction,
  db: PrismaClient
): Promise<ResolvedExtraction> {
  const resolvedParticipants = await Promise.all(
    extraction.participants.map(p => resolveParticipant(p, db))
  )

  const resolvedPlaceIds = await resolvePlaces(extraction.places_mentioned ?? [], db)
  const resolvedPlanIds = await resolvePlans(extraction.plans_mentioned ?? [], db)

  return {
    ...extraction,
    rawItem: item,
    participants: resolvedParticipants,
    resolvedPlaceIds,
    resolvedPlanIds,
  }
}

async function resolveParticipant(
  participant: Extraction["participants"][number],
  db: PrismaClient
): Promise<ResolvedParticipant> {
  const person = await findPerson(participant, db)
  return { ...participant, personId: person?.id }
}

async function findPerson(
  participant: { name: string; email?: string; phone?: string },
  db: PrismaClient
) {
  if (participant.email) {
    const persons = await db.person.findMany({
      where: { workspaceId: WORKSPACE_ID, emails: { contains: participant.email.toLowerCase() } },
      select: { id: true, first: true, last: true },
      take: 1,
    })
    if (persons.length > 0) return persons[0]
  }

  if (participant.phone) {
    const normalized = normalizePhoneDigits(participant.phone)
    if (normalized) {
      // Narrow via a cheap trailing-digits substring (survives "+1"/country-code
      // differences a raw contains on the full normalized value would miss),
      // then confirm each candidate with a true normalized comparison.
      const loose = await db.person.findMany({
        where: { workspaceId: WORKSPACE_ID, phones: { contains: normalized.slice(-7) } },
        select: { id: true, first: true, last: true, phones: true },
        take: 10,
      })
      const match = loose.find(p => safeJsonArray(p.phones).some(phone => phoneNumbersMatch(phone, participant.phone!)))
      if (match) return match
    }
  }

  if (participant.name) {
    const [first, ...rest] = participant.name.trim().split(/\s+/)
    const last = rest.join(" ")
    const persons = await db.person.findMany({
      where: {
        workspaceId: WORKSPACE_ID,
        first: { equals: first },
        ...(last ? { last: { equals: last } } : {}),
      },
      select: { id: true, first: true, last: true },
      take: 1,
    })
    if (persons.length > 0) return persons[0]
  }

  return null
}

async function resolvePlaces(names: string[], db: PrismaClient): Promise<string[]> {
  const ids: string[] = []
  for (const name of names) {
    const place = await db.place.findFirst({
      where: { workspaceId: WORKSPACE_ID, name: { contains: name } },
      select: { id: true },
    })
    if (place) ids.push(place.id)
  }
  return ids
}

async function resolvePlans(mentions: string[], db: PrismaClient): Promise<string[]> {
  const ids: string[] = []
  for (const mention of mentions) {
    const plan = await db.plan.findFirst({
      where: { workspaceId: WORKSPACE_ID, text: { contains: mention } },
      select: { id: true },
    })
    if (plan) ids.push(plan.id)
  }
  return ids
}

function safeJsonArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
