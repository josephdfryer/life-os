import { phoneNumbersMatch } from "@life-os/db"

export type InboxPersonCandidate = {
  id: string
  first: string
  last: string
  emails: string
  phones: string
  closeness: number | null
}

type ContactIdentity = {
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
}

export function findUniqueExactCandidate(input: ContactIdentity, candidates: InboxPersonCandidate[]) {
  const email = normalizeEmail(input.contactEmail)
  const phone = input.contactPhone?.trim() ?? ""
  const name = normalizeName(input.contactName)

  const emailMatch = unique(candidates.filter(candidate =>
    email && parseJsonArray(candidate.emails).some(value => normalizeEmail(value) === email),
  ))
  if (emailMatch) return { person: emailMatch, confidence: 100, reason: "Exact email match" }

  const phoneMatch = unique(candidates.filter(candidate =>
    phone && parseJsonArray(candidate.phones).some(value => phoneNumbersMatch(value, phone)),
  ))
  if (phoneMatch) return { person: phoneMatch, confidence: 99, reason: "Exact normalized phone match" }

  const nameMatch = unique(candidates.filter(candidate =>
    name && normalizeName(`${candidate.first} ${candidate.last}`) === name,
  ))
  if (nameMatch) return { person: nameMatch, confidence: 95, reason: "Unique exact complete-name match" }

  return null
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function unique(candidates: InboxPersonCandidate[]) {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]))
  return byId.size === 1 ? [...byId.values()][0] : null
}

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? ""
}

export function normalizePersonName(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? ""
}

const normalizeName = normalizePersonName
