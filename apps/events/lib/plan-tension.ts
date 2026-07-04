type PlanLike = {
  id: string
  text: string
  status: string
  scheduledStart: Date | null
  scheduledEnd: Date | null
}

type EventLike = {
  start: Date
  end: Date | null
  sourcePlanId: string | null
}

export type PlanTensionResult = {
  kind: "fulfilled" | "drift" | "unlinked" | "none"
  headline: string
  detail: string
  minutesDelta: number | null
}

export function computePlanTension(event: EventLike, sourcePlan: PlanLike | null): PlanTensionResult {
  if (!sourcePlan) {
    return {
      kind: "none",
      headline: "No linked plan",
      detail: "This event was not created from a declared Plan prediction.",
      minutesDelta: null,
    }
  }

  if (!sourcePlan.scheduledStart) {
    return {
      kind: "fulfilled",
      headline: "Plan fulfilled",
      detail: `Linked to plan: “${sourcePlan.text}”. The plan had no scheduled time to compare.`,
      minutesDelta: null,
    }
  }

  const predicted = sourcePlan.scheduledStart.getTime()
  const actual = event.start.getTime()
  const minutesDelta = Math.round((actual - predicted) / 60000)
  const absMinutes = Math.abs(minutesDelta)

  if (absMinutes <= 15) {
    return {
      kind: "fulfilled",
      headline: "Prediction matched reality",
      detail: `Plan “${sourcePlan.text}” started within ${absMinutes} minutes of the scheduled time.`,
      minutesDelta,
    }
  }

  const direction = minutesDelta > 0 ? "late" : "early"
  return {
    kind: "drift",
    headline: "Declared vs actual",
    detail: `Plan “${sourcePlan.text}” was scheduled for ${formatWhen(sourcePlan.scheduledStart)}, but the event started ${absMinutes} minutes ${direction}.`,
    minutesDelta,
  }
}

export function formatWhen(date: Date) {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}