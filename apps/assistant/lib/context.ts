import { db } from "@/lib/db"

const WORKSPACE_ID = process.env.LIFE_OS_WORKSPACE_ID ?? "default-workspace"

export interface LifeOSContext {
  todayEvents: { title: string; start: string; end?: string; place?: string }[] // title = Event.name
  openActionItems: { summary: string; person?: string; deadline?: string }[]
  relationshipNudges: { name: string; daysSince: number; closeness: number }[]
  inboxCount: number
  recentInteractions: { person?: string; type: string; summary?: string; timestamp: string }[]
}

export async function loadContext(): Promise<LifeOSContext> {
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now)
  todayEnd.setHours(23, 59, 59, 999)

  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [events, interactions, inboxCount, persons] = await Promise.all([
    // Today's events
    db.event.findMany({
      where: {
        workspaceId: WORKSPACE_ID,
        start: { gte: todayStart, lte: todayEnd },
      },
      select: {
        name: true,
        start: true,
        end: true,
        place: { select: { name: true } },
      },
      orderBy: { start: "asc" },
      take: 20,
    }),

    // Recent interactions (last 5)
    db.interaction.findMany({
      where: { workspaceId: WORKSPACE_ID, timestamp: { lte: now } },
      select: {
        type: true,
        timestamp: true,
        summary: true,
        actionItems: true,
        person: { select: { first: true, last: true } },
      },
      orderBy: { timestamp: "desc" },
      take: 5,
    }),

    // Pending inbox count
    db.stagedInteraction.count({
      where: { workspaceId: WORKSPACE_ID, status: "pending" },
    }),

    // People to check for nudges (closeness >= 3, no recent interaction)
    db.person.findMany({
      where: {
        workspaceId: WORKSPACE_ID,
        closeness: { gte: 3 },
      },
      select: {
        first: true,
        last: true,
        closeness: true,
        interactions: {
          where: { timestamp: { lte: now } },
          select: { timestamp: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
      },
      take: 100,
    }),
  ])

  // Compute relationship nudges: last contact > 30 days ago, high closeness
  const nudges = persons
    .map((p) => {
      const lastInteraction = p.interactions[0]
      const lastDate = lastInteraction ? new Date(lastInteraction.timestamp) : null
      const daysSince = lastDate
        ? Math.floor((now.getTime() - lastDate.getTime()) / 86400000)
        : 999
      return { name: `${p.first} ${p.last}`, daysSince, closeness: p.closeness }
    })
    .filter((n) => n.daysSince > 30)
    .sort((a, b) => b.closeness - a.closeness || b.daysSince - a.daysSince)
    .slice(0, 3)

  // Interactions with open action items
  const openActionItems = interactions
    .filter((i) => i.actionItems && i.actionItems.trim())
    .map((i) => ({
      summary: i.actionItems!,
      person: i.person ? `${i.person.first} ${i.person.last}` : undefined,
      deadline: undefined,
    }))
    .slice(0, 5)

  const recentInteractions = interactions.map((i) => ({
    person: i.person ? `${i.person.first} ${i.person.last}` : undefined,
    type: i.type,
    summary: i.summary ?? undefined,
    timestamp: i.timestamp.toISOString(),
  }))

  return {
    todayEvents: events.map((e) => ({
      title: e.name,
      start: e.start.toISOString(),
      end: e.end?.toISOString(),
      place: e.place?.name,
    })),
    openActionItems,
    relationshipNudges: nudges,
    inboxCount,
    recentInteractions,
  }
}

export function formatContextForPrompt(ctx: LifeOSContext): string {
  const lines: string[] = []

  if (ctx.todayEvents.length > 0) {
    lines.push("TODAY'S EVENTS:")
    for (const e of ctx.todayEvents) {
      const start = new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      lines.push(`  - ${e.title}${e.place ? ` @ ${e.place}` : ""} at ${start}`)
    }
  } else {
    lines.push("TODAY'S EVENTS: none scheduled")
  }

  if (ctx.openActionItems.length > 0) {
    lines.push("\nOPEN ACTION ITEMS:")
    for (const item of ctx.openActionItems) {
      const who = item.person ? ` (re: ${item.person})` : ""
      lines.push(`  - ${item.summary}${who}`)
    }
  }

  if (ctx.relationshipNudges.length > 0) {
    lines.push("\nRELATIONSHIP NUDGES (haven't connected recently):")
    for (const n of ctx.relationshipNudges) {
      lines.push(`  - ${n.name}: ${n.daysSince} days since last contact`)
    }
  }

  if (ctx.inboxCount > 0) {
    lines.push(`\nINBOX: ${ctx.inboxCount} pending item${ctx.inboxCount !== 1 ? "s" : ""}`)
  }

  if (ctx.recentInteractions.length > 0) {
    lines.push("\nRECENT INTERACTIONS:")
    for (const i of ctx.recentInteractions) {
      const date = new Date(i.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      const who = i.person ? ` with ${i.person}` : ""
      const detail = i.summary ? `: ${i.summary}` : ""
      lines.push(`  - ${i.type}${who} on ${date}${detail}`)
    }
  }

  return lines.join("\n")
}
