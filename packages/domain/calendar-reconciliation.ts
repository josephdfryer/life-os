export type CalendarReconciliationAction = "happened" | "changed" | "cancelled" | "skip"

export class CalendarReconciliationError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation" | "conflict") {
    super(message)
    this.name = "CalendarReconciliationError"
  }
}

export async function reconcileCalendarPlan(input: {
  workspaceId: string
  planId: string
  action: CalendarReconciliationAction
  title?: string
  start?: string
  end?: string | null
  personIds?: string[]
  placeId?: string | null
  outcome?: string | null
  emotionalWeight?: string | null
  followUps?: string[]
  note?: string | null
}) {
  const { db } = await import("@life-os/db")
  const plan = await db.plan.findFirst({
    where: { id: input.planId, workspaceId: input.workspaceId, externalSource: "google-calendar" },
    include: {
      expectedPeople: { select: { personId: true } },
      fulfilledBy: { select: { id: true } },
    },
  })
  if (!plan) throw new CalendarReconciliationError("Calendar Plan not found", "not_found")

  if (plan.fulfilledBy) {
    if (input.action === "happened" || input.action === "changed") {
      return { status: "happened" as const, eventId: plan.fulfilledBy.id }
    }
    throw new CalendarReconciliationError("This Plan is already confirmed as an Event", "conflict")
  }
  if (plan.reconciliationStatus && plan.reconciliationStatus !== "pending") {
    return { status: plan.reconciliationStatus, eventId: null }
  }

  if (input.action === "cancelled" || input.action === "skip") {
    await db.plan.update({
      where: { id: plan.id },
      data: {
        status: input.action === "cancelled" ? "abandoned" : plan.status,
        reconciliationStatus: input.action,
        reconciledAt: new Date(),
      },
    })
    return { status: input.action, eventId: null }
  }

  const title = input.title?.trim() || plan.text
  const start = parseDate(input.start, plan.scheduledStart, "A start time is required")
  const end = input.end === undefined
    ? plan.scheduledEnd
    : input.end
      ? parseDate(input.end, null, "End time is invalid")
      : null
  if (end && end < start) throw new CalendarReconciliationError("End time must be after start", "validation")

  const personIds = [...new Set(input.personIds ?? plan.expectedPeople.map(person => person.personId))]
  const [people, place] = await Promise.all([
    personIds.length
      ? db.person.findMany({ where: { workspaceId: input.workspaceId, id: { in: personIds } }, select: { id: true } })
      : [],
    input.placeId
      ? db.place.findFirst({ where: { workspaceId: input.workspaceId, id: input.placeId }, select: { id: true } })
      : null,
  ])
  if (people.length !== personIds.length) {
    throw new CalendarReconciliationError("One or more attendees are outside this workspace", "validation")
  }
  if (input.placeId && !place) {
    throw new CalendarReconciliationError("Place is outside this workspace", "validation")
  }

  const followUps = (input.followUps ?? []).map(value => value.trim()).filter(Boolean).slice(0, 20)
  const noteText = input.note?.trim() || null
  return db.$transaction(async tx => {
    const sourceNote = noteText
      ? await tx.note.create({
          data: {
            workspaceId: input.workspaceId,
            type: "observation",
            content: noteText,
            timestamp: start,
            metadata: JSON.stringify({ source: "calendar-reconciliation", planId: plan.id }),
          },
          select: { id: true },
        })
      : null
    const event = await tx.event.create({
      data: {
        workspaceId: input.workspaceId,
        name: title,
        type: "calendar",
        start,
        end,
        timestamp: start,
        placeId: place?.id ?? plan.placeId,
        sourcePlanId: plan.id,
        sourceNoteId: sourceNote?.id,
        metadata: JSON.stringify({ source: "calendar-reconciliation", action: input.action }),
      },
      select: { id: true },
    })
    for (const person of people) {
      const interaction = await tx.interaction.create({
        data: {
          workspaceId: input.workspaceId,
          personId: person.id,
          eventId: event.id,
          placeId: place?.id ?? plan.placeId,
          type: "calendar",
          timestamp: start,
          duration: end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)) : null,
          summary: title,
          outcome: input.outcome?.trim() || null,
          emotionalWeight: input.emotionalWeight?.trim() || null,
          actionItems: followUps.length
            ? JSON.stringify(followUps.map(description => ({ description, completed: false })))
            : null,
          sourceNoteId: sourceNote?.id,
        },
        select: { id: true },
      })
      await tx.interactionParticipant.createMany({
        data: [
          { interactionId: interaction.id, entityType: "Person", entityId: person.id, role: "participant", workspaceId: input.workspaceId },
          { interactionId: interaction.id, entityType: "Event", entityId: event.id, role: "context", workspaceId: input.workspaceId },
          { interactionId: interaction.id, entityType: "Plan", entityId: plan.id, role: "fulfilled", workspaceId: input.workspaceId },
        ],
      })
    }
    await tx.plan.update({
      where: { id: plan.id },
      data: { status: "completed", reconciliationStatus: "happened", reconciledAt: new Date() },
    })
    return { status: "happened" as const, eventId: event.id }
  })
}

function parseDate(value: string | undefined, fallback: Date | null, message: string) {
  if (value === undefined && fallback) return fallback
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) {
    throw new CalendarReconciliationError(message, "validation")
  }
  return date
}
