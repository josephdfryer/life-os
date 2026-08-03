import { db, type Prisma } from '@life-os/db'
import { cookies } from 'next/headers'
import { resolveTimeZone, TZ_COOKIE } from '@life-os/ui'
import { dayKey, parseActionItems, shiftDay } from '@/lib/daily'
import {
  ACTION_INBOX_BATCH_SIZE,
  UNCLAIMED_BATCH_SIZE,
  compareDue,
  dayToDate,
  daysBetween,
  isDueToday,
  isStale,
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

/**
 * Open commitments: unscheduled only, because once a Plan has a calendar slot it
 * belongs to Today rather than to the list of things still owed.
 */
function openCommitments(
  workspaceId: string,
  dueOn: Prisma.PlanWhereInput['dueOn'],
  orderBy: Prisma.PlanOrderByWithRelationInput,
  take: number,
) {
  return db.plan.findMany({
    where: { workspaceId, status: { in: ['active', 'blocked'] }, scheduledStart: null, dueOn },
    orderBy,
    select: {
      id: true,
      text: true,
      status: true,
      dueOn: true,
      deferCount: true,
      createdAt: true,
      person: { select: { id: true, first: true, last: true } },
    },
    take,
  })
}

export default async function CommitmentsWidget({ workspaceId, personsUrl }: Props) {
  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)
  const now = new Date()
  const weekStart = dayToDate(shiftDay(dayKey(now, tz), -7), tz)

  // Dated, undated, and draft candidates are fetched separately so neither a
  // Later list nor the Action Inbox can crowd out what is actually due now.
  const [dated, undated, actionInboxPlans, actionInboxTotal, interactions, clearedThisWeek] = await Promise.all([
    openCommitments(workspaceId, { not: null }, { dueOn: 'asc' }, DATED_SCAN_LIMIT),
    openCommitments(workspaceId, null, { createdAt: 'asc' }, PARKED_SCAN_LIMIT),
    db.plan.findMany({
      where: { workspaceId, status: 'draft', scheduledStart: null, dueOn: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        text: true,
        status: true,
        dueOn: true,
        deferCount: true,
        createdAt: true,
        person: { select: { id: true, first: true, last: true } },
      },
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

  const commitments: Commitment[] = [...dated, ...undated].map(plan => ({
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
  }))

  const todayKey = dayKey(now, tz)
  const today = commitments.filter(item => isDueToday(item.dueOn, todayKey)).sort(compareDue)
  const parked = commitments.filter(item => !isDueToday(item.dueOn, todayKey)).sort(compareDue)
  const actionInbox: Commitment[] = actionInboxPlans.map(plan => ({
    id: plan.id,
    text: plan.text,
    status: plan.status,
    dueOn: null,
    deferCount: plan.deferCount,
    createdAt: plan.createdAt.toISOString(),
    personId: plan.person?.id ?? null,
    personName: personLabel(plan.person),
    ageDays: daysBetween(plan.createdAt, now),
    stale: false,
  }))

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
      today={today}
      parked={parked}
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
