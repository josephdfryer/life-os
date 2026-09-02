import { db } from "@life-os/db"
import { unstable_cache } from "next/cache"
import { groupCommunications } from "@/lib/communication-groups"
import CommunicationsReview from "./CommunicationsReview"

export default async function CommunicationsReviewWidget({
  workspaceId,
  personsUrl,
}: {
  workspaceId: string
  personsUrl: string
}) {
  let groups: Awaited<ReturnType<typeof loadCommunicationGroups>> = []
  let failed = false

  try {
    groups = process.env.NODE_ENV === "production"
      ? await getCachedCommunicationGroups(workspaceId)
      : await loadCommunicationGroups(workspaceId)
  } catch (error) {
    console.error("[home] communications widget failed", error)
    failed = true
  }

  if (failed) {
    return (
      <section className="communications-review dashboard-communications-card" aria-labelledby="communications-heading">
        <div className="communications-heading">
          <div>
            <div className="quick-capture-eyebrow">Messages & email</div>
            <h2 id="communications-heading">Review communications</h2>
          </div>
        </div>
        <div className="capture-analysis-status">
          Communications review is temporarily unavailable.
          <a href={`${personsUrl}/inbox`} style={{ display: "block", marginTop: "10px", color: "var(--camel)" }}>
            Open inbox →
          </a>
        </div>
      </section>
    )
  }

  return (
    <CommunicationsReview
      personsUrl={personsUrl}
      initialItems={groups}
    />
  )
}

async function loadCommunicationGroups(workspaceId: string) {
  const startedAt = Date.now()
  const [rows, people] = await Promise.all([db.stagedInteraction.findMany({
    where: {
      workspaceId,
      status: { in: ["pending", "blocked"] },
      type: { not: "financial" },
      source: { in: ["imessage", "gmail", "whatsapp"] },
    },
    orderBy: [{ priority: "asc" }, { timestamp: "desc" }],
    take: 60,
    select: {
      id: true,
      source: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      summary: true,
      body: true,
      timestamp: true,
      direction: true,
      priority: true,
      candidatePersonId: true,
      candidatePerson: { select: { first: true, last: true } },
    },
  }), db.person.findMany({
    where: { workspaceId },
    select: { id: true, first: true, last: true, emails: true, phones: true },
    take: 500,
  })])
  const groups = groupCommunications(rows.map(row => {
    if (row.candidatePersonId) return row
    const match = uniqueExactPersonMatch(row, people)
    return match ? {
      ...row,
      candidatePersonId: match.id,
      candidatePerson: { first: match.first, last: match.last },
    } : row
  })).slice(0, 12)
  console.log(JSON.stringify({ level: "info", message: "home widget loaded", widget: "communications", durationMs: Date.now() - startedAt, count: groups.length }))
  return groups
}

function getCachedCommunicationGroups(workspaceId: string) {
  return unstable_cache(
    async () => loadCommunicationGroups(workspaceId),
    ["home-communications-read-model-v2", workspaceId],
    { revalidate: 30 },
  )()
}

function uniqueExactPersonMatch(
  row: { contactName: string | null; contactEmail: string | null; contactPhone: string | null },
  people: Array<{ id: string; first: string; last: string; emails: string; phones: string }>,
) {
  const email = normalizeEmail(row.contactEmail)
  const phone = normalizePhone(row.contactPhone)
  const name = normalizeName(row.contactName)
  const matches = people.filter(person => {
    if (email && parseList(person.emails).some(value => normalizeEmail(value) === email)) return true
    if (phone && parseList(person.phones).some(value => normalizePhone(value) === phone)) return true
    return Boolean(name && normalizeName(`${person.first} ${person.last}`) === name)
  })
  return matches.length === 1 ? matches[0] : null
}

function parseList(value: string) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function normalizeEmail(value: string | null) {
  return value?.trim().toLocaleLowerCase() ?? ""
}

function normalizePhone(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? ""
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
}

function normalizeName(value: string | null) {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? ""
}
