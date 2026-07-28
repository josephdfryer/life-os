import { db } from "@life-os/db"
import ReconciliationCards from "./ReconciliationCards"
import { reviewDayBounds, HOME_TIME_ZONE } from "@/lib/daily"

export default async function ReconciliationWidget({ workspaceId, day, tz = HOME_TIME_ZONE }: { workspaceId: string; day: string; tz?: string }) {
  const { start, end } = reviewDayBounds(day, tz)
  const [plans, places] = await Promise.all([
    db.plan.findMany({
      where: {
        workspaceId,
        externalSource: "google-calendar",
        reconciliationStatus: "pending",
        scheduledStart: { gte: start, lt: end },
        fulfilledBy: null,
        status: "active",
      },
      orderBy: { scheduledStart: "asc" },
      select: {
        id: true,
        text: true,
        scheduledStart: true,
        scheduledEnd: true,
        placeId: true,
        expectedPeople: {
          select: { person: { select: { id: true, first: true, last: true } } },
        },
      },
    }),
    db.place.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true },
    }),
  ])

  return (
    <ReconciliationCards
      plans={plans.map(plan => ({
        id: plan.id,
        title: plan.text,
        start: plan.scheduledStart!.toISOString(),
        end: plan.scheduledEnd?.toISOString() ?? null,
        placeId: plan.placeId,
        people: plan.expectedPeople.map(({ person }) => ({
          id: person.id,
          name: `${person.first} ${person.last}`.trim(),
        })),
      }))}
      places={places}
      day={day}
    />
  )
}
