import type { PersonListPerson } from "@/types"

export type PersonListView = "all" | "attention" | "active" | "no-history"

export type RelationshipStatus = {
  label: string
  detail: string | null
  tone: "quiet" | "current" | "plan" | "attention"
}

const CADENCE_DAYS: Record<number, number> = {
  2: 90,
  3: 21,
  4: 10,
}

const ACTIVE_WINDOW_DAYS = 30

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 86_400_000)
}

export function personListViewFilter(view: PersonListView, now = new Date()): Record<string, unknown> | null {
  if (view === "active") {
    return { interactions: { some: { timestamp: { gte: daysAgo(ACTIVE_WINDOW_DAYS, now), lte: now } } } }
  }

  if (view === "no-history") {
    return { interactions: { none: { timestamp: { lte: now } } } }
  }

  if (view === "attention") {
    return {
      OR: [
        { closeness: 4, interactions: { none: { timestamp: { gte: daysAgo(10, now), lte: now } } } },
        { closeness: 3, interactions: { none: { timestamp: { gte: daysAgo(21, now), lte: now } } } },
        { closeness: 2, interactions: { none: { timestamp: { gte: daysAgo(90, now), lte: now } } } },
        {
          closeness: 1,
          plans: { some: { status: "active" } },
          interactions: { none: { timestamp: { gte: daysAgo(30, now), lte: now } } },
        },
      ],
    }
  }

  return null
}

export function relationshipStatus(person: Pick<PersonListPerson, "activePlan" | "attentionScore" | "daysSinceLast" | "lastInteractionDate" | "closeness">): RelationshipStatus {
  const overdue = person.attentionScore >= 1

  if (person.activePlan) {
    return {
      label: overdue ? "Follow-up due" : "Active follow-up",
      detail: person.activePlan.text,
      tone: overdue ? "attention" : "plan",
    }
  }

  if (overdue) {
    if (!person.lastInteractionDate) {
      return {
        label: "First touch due",
        detail: null,
        tone: "attention",
      }
    }
    const cadence = CADENCE_DAYS[person.closeness]
    const daysPast = cadence && person.daysSinceLast !== null
      ? Math.max(1, person.daysSinceLast - cadence)
      : null
    return {
      label: "Due for a touch",
      detail: daysPast === null ? null : `${daysPast}d past usual`,
      tone: "attention",
    }
  }

  if (!person.lastInteractionDate) {
    return { label: "No history", detail: null, tone: "quiet" }
  }

  if ((person.daysSinceLast ?? Number.POSITIVE_INFINITY) <= ACTIVE_WINDOW_DAYS) {
    return { label: "In touch", detail: null, tone: "current" }
  }

  return { label: "History recorded", detail: null, tone: "quiet" }
}

export function personContext(person: Pick<PersonListPerson, "latestInteraction" | "title" | "headline" | "company" | "location" | "emails" | "phones">): string {
  const summary = person.latestInteraction?.summary?.trim()
  if (summary) return summary

  const role = person.title?.trim() || person.headline?.trim()
  if (role && person.company?.trim()) return `${role} at ${person.company.trim()}`
  if (role) return role
  if (person.company?.trim()) return person.company.trim()
  if (person.location?.trim()) return person.location.trim()
  if (person.emails[0]) return person.emails[0]
  if (person.phones[0]) return person.phones[0]
  return "No context yet · Add details"
}

// How the Person record itself came to exist (set once at creation — see
// packages/domain/persons.ts). Skips "manual" and unknown/legacy rows: a
// badge is only interesting when it tells you something, and "someone typed
// this in" is the default, not a fact worth a badge.
const SOURCE_BADGES: Record<string, { icon: string; label: string }> = {
  vcard:              { icon: "◈", label: "vCard import" },
  csv:                { icon: "▤", label: "CSV import" },
  spreadsheet:        { icon: "▤", label: "Spreadsheet import" },
  gmail_contacts:     { icon: "✉", label: "Gmail contacts" },
  interaction_import: { icon: "◔", label: "Found in an import" },
  api:                { icon: "⌁", label: "Added via API" },
  automation:         { icon: "⚙", label: "Added by automation" },
  system:             { icon: "◌", label: "System-created" },
}

export function personSourceBadge(source: string | null | undefined): { icon: string; label: string } | null {
  if (!source) return null
  return SOURCE_BADGES[source] ?? null
}

export function interactionSourceLabel(source: string | null | undefined, type: string | null | undefined): string {
  const value = (source || type || "interaction").toLowerCase()
  if (value === "whatsapp") return "WhatsApp"
  if (value === "imessage" || value === "message") return "iMessage"
  if (value === "gmail" || value === "email") return "Email"
  if (value === "calendar" || value === "meeting") return "Meeting"
  if (value === "call" || value === "phone") return "Call"
  return value.charAt(0).toUpperCase() + value.slice(1)
}
