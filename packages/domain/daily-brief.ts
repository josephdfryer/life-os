// Shared daily-assembly query, extracted from scripts/brief/generate.ts so
// there's exactly one place that answers "what happened/is happening on
// this day" — the CLI script (kept for scriptable/offline use) now calls
// this instead of running its own Prisma queries. See
// docs/ADAPTIVE_DAY_PLAN.md §4 ("absorb scripts/brief's daily-assembly role
// rather than duplicating it").

export type ActionItem = { description: string; deadline?: string; completed?: boolean }

function safeJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export type DailySummary = Awaited<ReturnType<typeof getDailySummary>>

export async function getDailySummary(workspaceId: string, since: Date, until: Date) {
  const { db } = await import("@life-os/db")

  const [events, interactions, actionItemRows, activePlans] = await Promise.all([
    db.event.findMany({
      where: { workspaceId, timestamp: { gte: since, lte: until } },
      select: {
        id: true, name: true, type: true, timestamp: true, notes: true,
        interactions: {
          select: {
            id: true, personId: true, type: true, emotionalWeight: true, outcome: true, actionItems: true,
            person: { select: { id: true, first: true, last: true } },
          },
        },
        place: { select: { name: true } },
      },
      orderBy: { timestamp: "asc" },
    }),
    db.interaction.findMany({
      where: { workspaceId, timestamp: { gte: since, lte: until }, eventId: null },
      select: {
        id: true, type: true, timestamp: true, summary: true, direction: true, actionItems: true,
        person: { select: { id: true, first: true, last: true } },
      },
      orderBy: { timestamp: "asc" },
      take: 100,
    }),
    db.interaction.findMany({
      where: { workspaceId, actionItems: { not: null }, timestamp: { gte: since, lte: until } },
      select: { actionItems: true, person: { select: { first: true, last: true } } },
    }),
    db.plan.findMany({
      where: { workspaceId, status: "active" },
      select: { id: true, text: true, timescale: true, person: { select: { first: true, last: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ])

  return {
    events,
    interactions,
    myActionItems: actionItemRows.flatMap(row => safeJsonArray<ActionItem>(row.actionItems)),
    activePlans,
  }
}
