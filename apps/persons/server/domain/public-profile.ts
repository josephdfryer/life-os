import { db } from "@/lib/db"
import { badRequest, conflict, notFound } from "@/server/api/errors"

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g")

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

// Picks the first available slug starting from a name-derived base,
// appending a short random suffix on collision so this never has to loop
// more than a couple of times in practice.
async function pickAvailableSlug(base: string, excludePersonId?: string) {
  const root = slugify(base) || "person"
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 6)}`
    const existing = await db.person.findFirst({ where: { publicSlug: candidate, NOT: excludePersonId ? { id: excludePersonId } : undefined }, select: { id: true } })
    if (!existing) return candidate
  }
  return `${root}-${Date.now().toString(36)}`
}

export type PublicProfileSettings = { publicProfileEnabled: boolean; publicSlug: string | null }

export async function getPublicProfileSettings(personId: string, workspaceId: string): Promise<PublicProfileSettings> {
  const person = await db.person.findFirst({
    where: { id: personId, workspaceId },
    select: { publicProfileEnabled: true, publicSlug: true },
  })
  if (!person) throw notFound("Person not found", { personId })
  return person
}

// Enabling with no existing slug mints one from the person's name. Disabling
// leaves the slug in place (so re-enabling keeps the same link) rather than
// clearing it — the page itself is gated on publicProfileEnabled, so a
// stale slug alone reveals nothing.
export async function setPublicProfileEnabled(personId: string, workspaceId: string, enabled: boolean): Promise<PublicProfileSettings> {
  const person = await db.person.findFirst({ where: { id: personId, workspaceId }, select: { publicSlug: true, first: true, last: true } })
  if (!person) throw notFound("Person not found", { personId })

  const slug = enabled ? (person.publicSlug ?? await pickAvailableSlug(`${person.first}-${person.last}`, personId)) : person.publicSlug
  return db.person.update({
    where: { id: personId },
    data: { publicProfileEnabled: enabled, publicSlug: slug },
    select: { publicProfileEnabled: true, publicSlug: true },
  })
}

export async function setPublicProfileSlug(personId: string, workspaceId: string, rawSlug: string): Promise<PublicProfileSettings> {
  const slug = rawSlug.trim().toLowerCase()
  if (!SLUG_RE.test(slug)) throw badRequest("Slugs are 3-50 characters: lowercase letters, numbers, and hyphens, not starting or ending with a hyphen", { slug })

  const person = await db.person.findFirst({ where: { id: personId, workspaceId }, select: { id: true } })
  if (!person) throw notFound("Person not found", { personId })

  const taken = await db.person.findFirst({ where: { publicSlug: slug, NOT: { id: personId } }, select: { id: true } })
  if (taken) throw conflict("That link is already taken", { slug })

  return db.person.update({
    where: { id: personId },
    data: { publicSlug: slug },
    select: { publicProfileEnabled: true, publicSlug: true },
  })
}

export type PublicProfileCard = {
  first: string
  last: string
  nickname: string | null
  title: string | null
  headline: string | null
  company: string | null
  location: string | null
  linkedin: string | null
  twitter: string | null
  website: string | null
  facebook: string | null
  instagram: string | null
  color: string | null
  colorSoft: string | null
}

// Public, unauthenticated lookup for the /profile/[slug] page — deliberately
// selects only identity/professional fields. Emails, phones, birthday, and
// notes are never part of this select, so there is no risk of them leaking
// onto the public page even if a future edit reuses this function's result.
export async function getPublicProfileBySlug(slug: string): Promise<PublicProfileCard | null> {
  return db.person.findFirst({
    where: { publicSlug: slug, publicProfileEnabled: true },
    select: {
      first: true, last: true, nickname: true, title: true, headline: true,
      company: true, location: true, linkedin: true, twitter: true, website: true,
      facebook: true, instagram: true, color: true, colorSoft: true,
    },
  })
}
