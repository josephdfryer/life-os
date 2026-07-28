import { db } from "@life-os/db"
import CommunicationsReview from "./CommunicationsReview"

export default async function CommunicationsReviewWidget({
  workspaceId,
  personsUrl,
}: {
  workspaceId: string
  personsUrl: string
}) {
  const rows = await db.stagedInteraction.findMany({
    where: {
      workspaceId,
      status: { in: ["pending", "blocked"] },
      type: { not: "financial" },
      source: { in: ["imessage", "gmail"] },
    },
    orderBy: [{ priority: "asc" }, { timestamp: "desc" }],
    take: 12,
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
      candidatePersonId: true,
      candidatePerson: { select: { first: true, last: true } },
    },
  })

  return (
    <CommunicationsReview
      personsUrl={personsUrl}
      initialItems={rows.map(row => ({
        id: row.id,
        source: row.source,
        contact: row.contactName || row.contactEmail || row.contactPhone || "Unknown sender",
        summary: row.summary || row.body || "No preview available",
        body: row.body,
        timestamp: row.timestamp.toISOString(),
        direction: row.direction,
        candidatePersonId: row.candidatePersonId,
        candidatePersonName: row.candidatePerson
          ? `${row.candidatePerson.first} ${row.candidatePerson.last}`.trim()
          : null,
      }))}
    />
  )
}
