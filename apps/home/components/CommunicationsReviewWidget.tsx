import { db } from "@life-os/db"
import { groupCommunications } from "@/lib/communication-groups"
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
  })
  const groups = groupCommunications(rows).slice(0, 12)

  return (
    <CommunicationsReview
      personsUrl={personsUrl}
      initialItems={groups}
    />
  )
}
