import { db } from "@life-os/db"
import WeeklyReviewActions from "./WeeklyReviewActions"

export default async function WeeklyReview({ workspaceId }: { workspaceId: string }) {
  const end = new Date()
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
  const stateTypes = ["energy", "mood", "stress"] as const
  const [planCount, fulfilled, plans, eventCount, events, interactionCount, interactionPeople, stateResults, notes] = await Promise.all([
    db.plan.count({
      where: { workspaceId, scheduledStart: { gte: start, lte: end } },
    }),
    db.plan.count({
      where: { workspaceId, scheduledStart: { gte: start, lte: end }, fulfilledBy: { isNot: null } },
    }),
    db.plan.findMany({
      where: { workspaceId, scheduledStart: { gte: start, lte: end } },
      select: { id: true, text: true, status: true },
      orderBy: { scheduledStart: "desc" },
      take: 8,
    }),
    db.event.count({ where: { workspaceId, start: { gte: start, lte: end } } }),
    db.event.findMany({
      where: { workspaceId, start: { gte: start, lte: end } },
      select: { id: true, name: true, start: true },
      orderBy: { start: "desc" },
      take: 8,
    }),
    db.interaction.count({
      where: { workspaceId, timestamp: { gte: start, lte: end } },
    }),
    db.interaction.groupBy({
      by: ["personId"],
      where: { workspaceId, timestamp: { gte: start, lte: end }, personId: { not: null } },
      _count: { personId: true },
      orderBy: { _count: { personId: "desc" } },
      take: 5,
    }),
    Promise.all(stateTypes.map(type => db.state.aggregate({
      where: {
        workspaceId,
        recordedAt: { gte: start, lte: end },
        entityType: "Person",
        definition: { type },
      },
      _avg: { severity: true },
    }))),
    db.note.count({ where: { workspaceId, timestamp: { gte: start, lte: end } } }),
  ])
  const personIds = interactionPeople.flatMap(row => row.personId ? [row.personId] : [])
  const personRows = personIds.length
    ? await db.person.findMany({
        where: { workspaceId, id: { in: personIds } },
        select: { id: true, first: true, last: true },
      })
    : []
  const personById = new Map(personRows.map(person => [person.id, person]))
  const people = new Map<string, { name: string; count: number }>()
  for (const row of interactionPeople) {
    if (!row.personId) continue
    const person = personById.get(row.personId)
    if (!person) continue
    people.set(person.id, {
      name: `${person.first} ${person.last}`.trim(),
      count: row._count.personId,
    })
  }
  const stateAverages = stateTypes.flatMap((type, index) => {
    const average = stateResults[index]._avg.severity
    return average == null ? [] : [{ type, average }]
  })
  return (
    <section className="weekly-review">
      <div className="quick-capture-eyebrow">Last seven days · derived live</div>
      <h2>Weekly review</h2>
      <div className="weekly-metrics">
        <Metric value={`${fulfilled}/${planCount}`} label="scheduled Plans fulfilled" />
        <Metric value={String(eventCount)} label="Events recorded" />
        <Metric value={String(interactionCount)} label="Interactions" />
        <Metric value={String(notes)} label="Notes captured" />
      </div>
      <div className="weekly-evidence-grid">
        <div>
          <h3>People in the week</h3>
          {[...people.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(([id, person]) => (
            <a key={id} href={`https://persons.lacollecteur.com/persons/${id}`}>{person.name}<span>{person.count}</span></a>
          ))}
          {!people.size && <p>No Person-linked Interactions recorded.</p>}
        </div>
        <div>
          <h3>Personal States</h3>
          {stateAverages.map(state => <p key={state.type}>{state.type}: <strong>{state.average.toFixed(1)} / 5</strong></p>)}
          {!stateAverages.length && <p>No check-ins recorded yet.</p>}
        </div>
      </div>
      <details>
        <summary>Evidence</summary>
        <ul>
          {plans.map(plan => <li key={plan.id}>{plan.text} · {plan.status}</li>)}
          {events.map(event => <li key={event.id}><a href={`https://events.lacollecteur.com/events/${event.id}`}>{event.name}</a> · {event.start.toLocaleDateString()}</li>)}
        </ul>
      </details>
      <WeeklyReviewActions />
    </section>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>
}
