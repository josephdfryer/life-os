import type { ParsedContact } from "@/lib/vcard"

// The matching algorithm itself (findMatch, computeFillableFields, the
// Jaro-Winkler scorer, thresholds) moved to packages/domain/contact-matching.ts
// so apps/api's device contacts-sync ingest handler can reuse it —
// ParsedContact and this app's Person type both structurally satisfy the
// shared module's generic MatchableContact/MatchableExistingPerson types, so
// every call site in this app is unchanged.
//
// Imported from the contact-matching submodule directly, not the `@life-os/domain`
// barrel — this file is pulled into a "use client" page (page.tsx), and the
// barrel also re-exports plans.ts, which drags packages/db (libsql,
// better-sqlite3 native bindings) into the client bundle and breaks the build.
import {
  DUPLICATE_THRESHOLD,
  POSSIBLE_THRESHOLD,
  normalizeMatchText,
  normalizeEmailForMatch,
  normalizePhoneForMatch,
  jaro,
  jaroWinkler,
  computeFillableFields,
  findMatch,
  type MatchResult,
} from "@life-os/domain/contact-matching"

export {
  DUPLICATE_THRESHOLD,
  POSSIBLE_THRESHOLD,
  normalizeMatchText,
  normalizeEmailForMatch,
  normalizePhoneForMatch,
  jaro,
  jaroWinkler,
  computeFillableFields,
  findMatch,
  type MatchResult,
}

export type ContactAction = "import" | "update_existing" | "import_new" | "skip"
export type ReviewContact = ParsedContact & { closeness: number; tags: string; skip: boolean; colorIdx: number; guessedName: boolean; guessedFrom: string | null; needsReview: boolean; matchResult: MatchResult | null; action: ContactAction; selected: boolean }
export type ContactStatus = "ready" | "review" | "error" | "duplicate" | "possible"
export type QualityStats = { total: number; needsReview: number; guessedName: number; noEmail: number; noPhone: number; noCompany: number; duplicates: number; possibles: number }

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
export function guessNameFromEmail(email: string): { first: string; last: string } | null {
  const local = email.split("@")[0]
  if (!local) return null
  const cleaned = local.replace(/\d+$/, "").replace(/^[._-]+|[._-]+$/g, "")
  if (cleaned.length < 2) return null
  for (const separator of [".", "_", "-"]) {
    const parts = cleaned.split(separator).filter(part => part.length >= 2)
    if (parts.length >= 2) return { first: capitalize(parts[0]), last: capitalize(parts.at(-1)!) }
  }
  return { first: capitalize(cleaned), last: "" }
}

export function getStatus(contact: ReviewContact): ContactStatus {
  if (contact.matchResult) return contact.matchResult.score >= DUPLICATE_THRESHOLD ? "duplicate" : "possible"
  if (!contact.first?.trim() && !contact.email) return "error"
  if (contact.guessedName || !contact.email) return "review"
  return "ready"
}
export function sortByStatus(contacts: ReviewContact[]): ReviewContact[] {
  const rank = (contact: ReviewContact) => contact.skip ? 5 : ({ duplicate: 0, possible: 1, error: 2, review: 3, ready: 4 } as const)[getStatus(contact)]
  return [...contacts].sort((a, b) => rank(a) - rank(b))
}
export function computeStats(contacts: ReviewContact[]): QualityStats {
  return { total: contacts.length, needsReview: contacts.filter(value => value.needsReview).length, guessedName: contacts.filter(value => value.guessedName).length, noEmail: contacts.filter(value => !value.email).length, noPhone: contacts.filter(value => !value.phone).length, noCompany: contacts.filter(value => !value.company).length, duplicates: contacts.filter(value => !value.skip && value.matchResult !== null && value.matchResult.score >= DUPLICATE_THRESHOLD).length, possibles: contacts.filter(value => !value.skip && value.matchResult !== null && value.matchResult.score < DUPLICATE_THRESHOLD).length }
}
