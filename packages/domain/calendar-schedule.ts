import { BACKGROUND_EVENT_TYPES } from "./event-primitive"
import {
  attendancePhase,
  attendanceTension,
  parseOwnerAttendance,
  resolveOwnerAttendance,
  type AttendanceTension,
  type OwnerAttendance,
  type OwnerAttendanceAction,
} from "./calendar-attendance"
import { reconcileCalendarPlan } from "./calendar-reconciliation"
import { PlanError } from "./plans"

export type TimelineView = "today" | "upcoming" | "past" | "all"

export type ScheduleItemKind = "event" | "plan"

export type SchedulePerson = {
  id: string
  name: string
}

export type ScheduleItem = {
  id: string
  kind: ScheduleItemKind
  name: string
  start: Date
  end: Date | null
  href: string | null
  type: string
  scheduled: boolean
  place: { name: string } | null
  attendees: SchedulePerson[]
  calendars: string[]
  interactionCount: number
  planId: string | null
  eventId: string | null
  declaredAttendance: OwnerAttendance
  attendanceSource: "override" | "calendar"
  reconciliationStatus: string | null
  tension: AttendanceTension
  phase: "future" | "past"
}

export function timelineWindow(view: TimelineView, dayStart: Date, dayEnd: Date) {
  switch (view) {
    case "today":
      return { gte: dayStart, lt: dayEnd }
    case "upcoming":
      return { gte: dayStart }
    case "past":
      return { lt: dayStart }
    case "all":
      return undefined
  }
}

export async function listScheduleItems(input: {
  workspaceId: string
  view: TimelineView
  dayStart: Date
  dayEnd: Date
  now?: Date
  search?: string
  take?: number
  eventHref: (eventId: string) => string
}): Promise<ScheduleItem[]> {
  const { db } = await import("@life-os/db")
  const now = input.now ?? new Date()
  const take = input.take ?? 100
  const window = timelineWindow(input.view, input.dayStart, input.dayEnd)
  const search = input.search?.trim()

  const [events, plans] = await Promise.all([
    db.event.findMany({
      where: {
        workspaceId: input.workspaceId,
        type: { notIn: [...BACKGROUND_EVENT_TYPES] },
        ...(window ? { start: window } : {}),
        ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      },
      include: {
        place: { select: { name: true } },
        interactions: {
          where: { personId: { not: null } },
          include: { person: { select: { id: true, first: true, last: true } } },
          take: 4,
        },
        _count: { select: { interactions: true } },
        calendarLinks: {
          where: { status: { not: "cancelled" } },
          select: {
            calendarId: true,
            planId: true,
            connection: { select: { calendarSummary: true, ownerAttendanceDefault: true } },
          },
        },
        sourcePlan: { select: { id: true, ownerAttendance: true, reconciliationStatus: true } },
      },
      orderBy: input.view === "past" || input.view === "all"
        ? { start: "desc" as const }
        : { start: "asc" as const },
      take,
    }),
    db.plan.findMany({
      where: {
        workspaceId: input.workspaceId,
        externalSource: "google-calendar",
        status: { not: "abandoned" },
        OR: [{ reconciliationStatus: null }, { reconciliationStatus: "pending" }],
        scheduledStart: window ?? { not: null },
        ...(search ? { text: { contains: search, mode: "insensitive" as const } } : {}),
      },
      include: {
        place: { select: { name: true } },
        expectedPeople: {
          select: { person: { select: { id: true, first: true, last: true } } },
          take: 4,
        },
        calendarLinks: {
          where: { status: { not: "cancelled" } },
          select: {
            calendarId: true,
            connection: { select: { calendarSummary: true, ownerAttendanceDefault: true } },
          },
        },
      },
      orderBy: input.view === "past" || input.view === "all"
        ? { scheduledStart: "desc" as const }
        : { scheduledStart: "asc" as const },
      take,
    }),
  ])

  const confirmedPlanIds = new Set(
    events.flatMap((event) => [
      event.sourcePlanId,
      ...event.calendarLinks.map((link) => link.planId),
    ]).filter((id): id is string => Boolean(id)),
  )

  const eventItems = events.map((event): ScheduleItem => {
    const calendars = unique(event.calendarLinks.map((link) =>
      link.connection.calendarSummary ?? link.calendarId,
    ))
    const declared = resolveOwnerAttendance({
      ownerAttendance: event.sourcePlan?.ownerAttendance,
      calendarDefaults: event.calendarLinks.map((link) => link.connection.ownerAttendanceDefault),
    })
    const attendees = uniquePeople(event.interactions.flatMap((interaction) =>
      interaction.person
        ? [{ id: interaction.person.id, name: personName(interaction.person) }]
        : [],
    ))
    return {
      id: event.id,
      kind: "event",
      name: event.name,
      start: event.start,
      end: event.end,
      href: input.eventHref(event.id),
      type: event.type,
      scheduled: event.type === "calendar" || event.calendarLinks.length > 0,
      place: event.place,
      attendees,
      calendars,
      interactionCount: event._count.interactions,
      planId: event.sourcePlan?.id ?? event.calendarLinks.find((link) => link.planId)?.planId ?? null,
      eventId: event.id,
      declaredAttendance: declared,
      attendanceSource: parseOwnerAttendance(event.sourcePlan?.ownerAttendance) ? "override" : "calendar",
      reconciliationStatus: event.sourcePlan?.reconciliationStatus ?? "happened",
      tension: attendanceTension({
        declared,
        reconciliationStatus: event.sourcePlan?.reconciliationStatus ?? "happened",
      }),
      phase: attendancePhase(event.start, now),
    }
  })

  const planItems = plans.flatMap((plan): ScheduleItem[] => {
    if (!plan.scheduledStart || confirmedPlanIds.has(plan.id)) return []
    const calendars = unique(plan.calendarLinks.map((link) =>
      link.connection.calendarSummary ?? link.calendarId,
    ))
    const declared = resolveOwnerAttendance({
      ownerAttendance: plan.ownerAttendance,
      calendarDefaults: plan.calendarLinks.map((link) => link.connection.ownerAttendanceDefault),
    })
    return [{
      id: `plan-${plan.id}`,
      kind: "plan",
      name: plan.text,
      start: plan.scheduledStart,
      end: plan.scheduledEnd,
      href: null,
      type: "calendar",
      scheduled: true,
      place: plan.place,
      attendees: uniquePeople(plan.expectedPeople.map(({ person }) => ({
        id: person.id,
        name: personName(person),
      }))),
      calendars,
      interactionCount: 0,
      planId: plan.id,
      eventId: null,
      declaredAttendance: declared,
      attendanceSource: parseOwnerAttendance(plan.ownerAttendance) ? "override" : "calendar",
      reconciliationStatus: plan.reconciliationStatus,
      tension: attendanceTension({
        declared,
        reconciliationStatus: plan.reconciliationStatus,
      }),
      phase: attendancePhase(plan.scheduledStart, now),
    }]
  })

  const combined = [...eventItems, ...planItems].sort((a, b) => {
    const delta = a.start.getTime() - b.start.getTime()
    if (input.view === "past" || input.view === "all") return delta === 0 ? a.name.localeCompare(b.name) : -delta
    return delta === 0 ? a.name.localeCompare(b.name) : delta
  })
  return combined.slice(0, take)
}

export async function setPlanOwnerAttendance(input: {
  workspaceId: string
  planId: string
  attendance: OwnerAttendance
}) {
  const { db } = await import("@life-os/db")
  const plan = await db.plan.findFirst({
    where: { id: input.planId, workspaceId: input.workspaceId, externalSource: "google-calendar" },
    select: { id: true },
  })
  if (!plan) throw new PlanError("Calendar Plan not found", "not_found")
  return db.plan.update({
    where: { id: plan.id },
    data: { ownerAttendance: input.attendance },
    select: { id: true, ownerAttendance: true, reconciliationStatus: true },
  })
}

export async function recordOwnerAttendance(input: {
  workspaceId: string
  planId: string
  action: OwnerAttendanceAction
}) {
  if (input.action === "going" || input.action === "not_going") {
    const plan = await setPlanOwnerAttendance({
      workspaceId: input.workspaceId,
      planId: input.planId,
      attendance: input.action,
    })
    return {
      kind: "intent" as const,
      planId: plan.id,
      attendance: plan.ownerAttendance,
      reconciliationStatus: plan.reconciliationStatus,
      eventId: null,
    }
  }

  const result = await reconcileCalendarPlan({
    workspaceId: input.workspaceId,
    planId: input.planId,
    action: input.action === "did_go" ? "happened" : "skip",
  })
  return {
    kind: "outcome" as const,
    planId: input.planId,
    attendance: null,
    reconciliationStatus: result.status,
    eventId: result.eventId,
  }
}

function personName(person: { first: string; last: string | null }) {
  return `${person.first} ${person.last ?? ""}`.trim()
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function uniquePeople(people: SchedulePerson[]) {
  return [...new Map(people.map((person) => [person.id, person])).values()]
}
