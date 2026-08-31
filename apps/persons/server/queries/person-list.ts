import { Prisma } from "@life-os/db"
import { relationshipGapScore } from "@life-os/alignment/pure"
import { parseTags } from "@/lib/utils"
import type { PersonListPerson } from "@/types"

export function personListInclude(now = new Date()) {
  return {
    interactions: {
      where: { timestamp: { lte: now } },
      take: 1,
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        type: true,
        source: true,
        timestamp: true,
        summary: true,
        // Only select fields we actually use in the UI
      },
    },
    plans: {
      where: { status: "active" },
      orderBy: [{ dueOn: "asc" }, { createdAt: "desc" }],
      take: 1,
      select: {
        id: true,
        text: true,
        dueOn: true,
        // Only select fields we need
      },
    },
    // Don't include groupMemberships unless specifically needed
  } as const satisfies Prisma.PersonInclude
}

type PersonListRow = Prisma.PersonGetPayload<{ include: ReturnType<typeof personListInclude> }>

export function serializePersonListRow(person: PersonListRow): PersonListPerson {
  const latest = person.interactions[0] ?? null
  const activePlan = person.plans[0] ?? null
  const lastInteractionDate = latest?.timestamp ?? null
  const daysSinceLast = lastInteractionDate
    ? Math.max(0, Math.floor((Date.now() - lastInteractionDate.getTime()) / 86_400_000))
    : null
  const attentionScore = relationshipGapScore({
    closeness: person.closeness,
    lastInteractionAt: lastInteractionDate,
    hasActivePlan: activePlan !== null,
  })
  const { interactions: _interactions, plans: _plans, ...rest } = person

  return {
    ...rest,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
    tags: parseTags(person.tags),
    values: parseTags(person.values),
    emails: parseTags(person.emails),
    phones: parseTags(person.phones),
    interactions: [],
    latestInteraction: latest ? {
      id: latest.id,
      type: latest.type,
      source: latest.source,
      timestamp: latest.timestamp.toISOString(),
      summary: latest.summary,
    } : null,
    activePlan: activePlan ? {
      id: activePlan.id,
      text: activePlan.text,
      dueOn: activePlan.dueOn?.toISOString() ?? null,
    } : null,
    lastInteractionDate: lastInteractionDate?.toISOString() ?? null,
    daysSinceLast,
    attentionScore,
  }
}
