import { db } from "@life-os/db"
import WeeklyReviewActions from "./WeeklyReviewActions"

export default async function WeeklyReview({ workspaceId }: { workspaceId: string }) {
  const end = new Date()
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
  const [plans, events, interactions, states, notes] = await Promise.all([
    db.plan.findMany({
      where: { workspaceId, scheduledStart: { gte: start, lte: end } },
      select: { id: true, text: true, status: true, scheduledStart: true, fulfilledBy: { select: { id: true } } },
    }),
    db.event.findMany({ where: { workspaceId, start: { gte: start, lte: end } }, select: { id: true, name: true, start: true } }),
    db.interaction.findMany({
      where: { workspaceId, timestamp: { gte: start, lte: end } },
      select: { id: true, emotionalWeight: true, person: { select: { id: true, first: true, last: true } } },
    }),
    db.state.findMany({
      where: { workspaceId, recordedAt: { gte: start, lte: end }, entityType: "Person" },
      select: { id: true, severity: true, definition: { select: { type: true } } },
    }),
    db.note.count({ where: { workspaceId, timestamp: { gte: start, lte: end } } }),
  ])
  const fulfilled = plans.filter(plan => plan.fulfilledBy).length
  const people = new Map<string, { name: string; count: number }>()
  for (const interaction of interactions) {
    if (!interaction.person) continue
    const current = people.get(interaction.person.id)
    people.set(interaction.person.id, {
      name: `${interaction.person.first} ${interaction.person.last}`.trim(),
      count: (current?.count ?? 0) + 1,
    })
  }
  const stateAverages = ["energy", "mood", "stress"].flatMap(type => {
    const values = states.filter(state => state.definition.type === type).flatMap(state => state.severity == null ? [] : [state.severity])
    return values.length ? [{ type, average: values.reduce((sum, value) => sum + value, 0) / values.length }] : []
  })
  return (
    <section className="weekly-review">
      <div className="quick-capture-eyebrow">Last seven days · derived live</div>
      <h2>Weekly review</h2>
      <div className="weekly-metrics">
        <Metric value={`${fulfilled}/${plans.length}`} label="scheduled Plans fulfilled" />
        <Metric value={String(events.length)} label="Events recorded" />
        <Metric value={String(interactions.length)} label="Interactions" />
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
          {plans.slice(0, 8).map(plan => <li key={plan.id}>{plan.text} · {plan.status}</li>)}
          {events.slice(0, 8).map(event => <li key={event.id}><a href={`https://events.lacollecteur.com/events/${event.id}`}>{event.name}</a> · {event.start.toLocaleDateString()}</li>)}
        </ul>
      </details>
      <WeeklyReviewActions />
    </section>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>
}
