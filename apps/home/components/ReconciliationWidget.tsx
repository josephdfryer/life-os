import { db } from "@life-os/db"
import ReconciliationCards from "./ReconciliationCards"

export default async function ReconciliationWidget({ workspaceId }: { workspaceId: string }) {
  const now = new Date()
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const [plans, places] = await Promise.all([
    db.plan.findMany({
      where: {
        workspaceId,
        externalSource: "google-calendar",
        reconciliationStatus: "pending",
        scheduledStart: { gte: since, lt: now },
        fulfilledBy: null,
        status: "active",
      },
      orderBy: { scheduledStart: "desc" },
      take: 3,
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

  if (!plans.length) return null
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
    />
  )
}
