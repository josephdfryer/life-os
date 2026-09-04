import { db, type Prisma } from '@life-os/db'
import { cookies } from 'next/headers'
import { resolveTimeZone, TZ_COOKIE } from '@life-os/ui'
import { dayKey, parseActionItems, shiftDay } from '@/lib/daily'
import {
  ACTION_INBOX_BATCH_SIZE,
  MAX_FOCUS,
  UNCLAIMED_BATCH_SIZE,
  compareDue,
  compareFocus,
  dayToDate,
  daysBetween,
  isStale,
  rankSuggestions,
  type Commitment,
  type UnclaimedItem,
} from '@/lib/commitments'
import CommitmentsPanel from './CommitmentsPanel'

interface Props {
  workspaceId: string
  personsUrl: string
}

/** Enough rows to find the open ones without reading the whole history. */
const DATED_SCAN_LIMIT = 40
const PARKED_SCAN_LIMIT = 40
const INTERACTION_SCAN_LIMIT = 80

const PLAN_SELECT = {
  id: true,
  text: true,
  status: true,
  dueOn: true,
  deferCount: true,
  createdAt: true,
  focusedAt: true,
  person: { select: { id: true, first: true, last: true } },
} as const

/**
 * Backlog commitments: unscheduled and not currently in Focus. Once a Plan has
 * a calendar slot it belongs to the schedule rather than the backlog; once
 * it's focused it belongs to the Focus queue, not here.
 */
function backlogCommitments(
  workspaceId: string,
  dueOn: Prisma.PlanWhereInput['dueOn'],
  orderBy: Prisma.PlanOrderByWithRelationInput,
  take: number,
) {
  return db.plan.findMany({
    where: { workspaceId, status: { in: ['active', 'blocked'] }, scheduledStart: null, focusedAt: null, dueOn },
    orderBy,
    select: PLAN_SELECT,
    take,
  })
}

export default async function CommitmentsWidget({ workspaceId, personsUrl }: Props) {
  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)
  const now = new Date()
  const weekStart = dayToDate(shiftDay(dayKey(now, tz), -7), tz)

  // Focus, backlog, and draft candidates are fetched separately so none of
  // them can crowd out the others. Focus is a hand-picked, date-independent
  // queue — it is never derived from dueOn.
  const [focusedPlans, dated, undated, actionInboxPlans, actionInboxTotal, interactions, clearedThisWeek] = await Promise.all([
    db.plan.findMany({
      where: { workspaceId, status: { in: ['active', 'blocked'] }, focusedAt: { not: null } },
      orderBy: { focusedAt: 'asc' },
      select: PLAN_SELECT,
      take: MAX_FOCUS,
    }),
    backlogCommitments(workspaceId, { not: null }, { dueOn: 'asc' }, DATED_SCAN_LIMIT),
    backlogCommitments(workspaceId, null, { createdAt: 'asc' }, PARKED_SCAN_LIMIT),
    db.plan.findMany({
      where: { workspaceId, status: 'draft', scheduledStart: null, dueOn: null },
      orderBy: { createdAt: 'asc' },
      select: PLAN_SELECT,
      take: ACTION_INBOX_BATCH_SIZE,
    }),
    db.plan.count({
      where: { workspaceId, status: 'draft', scheduledStart: null, dueOn: null },
    }),
    db.interaction.findMany({
      where: { workspaceId, actionItems: { not: null } },
      orderBy: { timestamp: 'desc' },
      select: {
        id: true,
        timestamp: true,
        actionItems: true,
        person: { select: { id: true, first: true, last: true } },
        event: { select: { name: true } },
      },
      take: INTERACTION_SCAN_LIMIT,
    }),
    db.plan.count({
      where: { workspaceId, status: 'completed', completedAt: { gte: weekStart } },
    }),
  ])

  const toCommitment = (plan: (typeof focusedPlans)[number]): Commitment => ({
    id: plan.id,
    text: plan.text,
    status: plan.status,
    dueOn: plan.dueOn ? dayKey(plan.dueOn, tz) : null,
    deferCount: plan.deferCount,
    createdAt: plan.createdAt.toISOString(),
    personId: plan.person?.id ?? null,
    personName: personLabel(plan.person),
    ageDays: daysBetween(plan.createdAt, now),
    stale: isStale(plan.deferCount),
    focusedAt: plan.focusedAt ? plan.focusedAt.toISOString() : null,
  })

  const todayKey = dayKey(now, tz)
  const focused = focusedPlans.map(toCommitment).sort(compareFocus)
  const backlog = [...dated, ...undated].map(toCommitment).sort(compareDue)
  const actionInbox: Commitment[] = actionInboxPlans.map(toCommitment)

  // One explainable suggestion for the next open Focus slot, pulled from
  // whichever of the backlog or Action Inbox has waited longest. Never more
  // than one at a time — Focus fills by a single deliberate pull, not a batch.
  const suggestion = focused.length < MAX_FOCUS
    ? rankSuggestions([...actionInbox, ...backlog])[0] ?? null
    : null

  // Unclaimed action items: raw lines pulled out of conversations. They are not
  // commitments until Joseph says they are, so they are counted, not listed.
  const unclaimed: UnclaimedItem[] = []
  for (const interaction of interactions) {
    parseActionItems(interaction.actionItems).forEach((item, index) => {
      if (item.completed) return
      unclaimed.push({
        id: `${interaction.id}:${index}`,
        interactionId: interaction.id,
        index,
        text: item.description,
        personId: interaction.person?.id ?? null,
        personName: personLabel(interaction.person),
        eventName: interaction.event?.name ?? null,
        timestamp: interaction.timestamp.toISOString(),
        ageDays: daysBetween(interaction.timestamp, now),
      })
    })
  }
  // Oldest first — the longest-ignored line is the one most worth a decision.
  unclaimed.sort((a, b) => b.ageDays - a.ageDays)

  return (
    <CommitmentsPanel
      focused={focused}
      suggestion={suggestion}
      backlog={backlog}
      actionInbox={actionInbox}
      actionInboxTotal={actionInboxTotal}
      unclaimed={unclaimed.slice(0, UNCLAIMED_BATCH_SIZE)}
      unclaimedTotal={unclaimed.length}
      clearedThisWeek={clearedThisWeek}
      todayKey={todayKey}
      personsUrl={personsUrl}
    />
  )
}

function personLabel(person: { first: string; last: string | null } | null) {
  if (!person) return null
  return `${person.first} ${person.last ?? ''}`.trim()
}
