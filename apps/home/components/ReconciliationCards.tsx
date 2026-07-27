"use client"

import { useState } from "react"

type Person = { id: string; name: string }
type Plan = {
  id: string
  title: string
  start: string
  end: string | null
  placeId: string | null
  people: Person[]
}

export default function ReconciliationCards({
  plans: initialPlans,
  places,
}: {
  plans: Plan[]
  places: Array<{ id: string; name: string }>
}) {
  const [plans, setPlans] = useState(initialPlans)
  if (!plans.length) return null

  return (
    <section className="reconcile-widget" aria-labelledby="reconcile-heading">
      <div className="reconcile-heading">
        <div>
          <div className="quick-capture-eyebrow">Recently ended</div>
          <h2 id="reconcile-heading">Did this happen?</h2>
        </div>
        <span>{plans.length} to review</span>
      </div>
      <div className="reconcile-list">
        {plans.map(plan => (
          <ReconciliationCard
            key={plan.id}
            plan={plan}
            places={places}
            onResolved={() => setPlans(current => current.filter(item => item.id !== plan.id))}
          />
        ))}
      </div>
    </section>
  )
}

function ReconciliationCard({
  plan,
  places,
  onResolved,
}: {
  plan: Plan
  places: Array<{ id: string; name: string }>
  onResolved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [title, setTitle] = useState(plan.title)
  const [start, setStart] = useState(toLocal(plan.start))
  const [end, setEnd] = useState(toLocal(plan.end))
  const [personIds, setPersonIds] = useState(plan.people.map(person => person.id))
  const [placeId, setPlaceId] = useState(plan.placeId ?? "")
  const [outcome, setOutcome] = useState("")
  const [emotionalWeight, setEmotionalWeight] = useState("")
  const [followUps, setFollowUps] = useState("")
  const [note, setNote] = useState("")

  async function reconcile(action: "happened" | "changed" | "cancelled" | "skip") {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/calendar/plans/${plan.id}/reconcile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "changed" ? {
          action,
          title,
          start: new Date(start).toISOString(),
          end: end ? new Date(end).toISOString() : null,
          personIds,
          placeId: placeId || null,
          outcome: outcome || null,
          emotionalWeight: emotionalWeight || null,
          followUps: followUps.split("\n").map(value => value.trim()).filter(Boolean),
          note: note || null,
        } : { action }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || "Could not reconcile this Plan")
      onResolved()
    } catch (reconcileError) {
      setError(reconcileError instanceof Error ? reconcileError.message : "Could not reconcile this Plan")
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="reconcile-card">
      <div className="reconcile-summary">
        <div>
          <strong>{plan.title}</strong>
          <span>{formatWhen(plan.start)}{plan.people.length ? ` · ${plan.people.map(person => person.name).join(", ")}` : ""}</span>
        </div>
        <button type="button" className="capture-submit" disabled={busy} onClick={() => reconcile("happened")}>
          Happened
        </button>
      </div>
      <div className="reconcile-actions">
        <button type="button" disabled={busy} onClick={() => setEditing(value => !value)}>Changed</button>
        <button type="button" disabled={busy} onClick={() => reconcile("cancelled")}>Cancelled</button>
        <button type="button" disabled={busy} onClick={() => reconcile("skip")}>Skip</button>
      </div>
      {editing && (
        <div className="reconcile-editor">
          <label><span>What happened</span><input value={title} onChange={event => setTitle(event.target.value)} /></label>
          <div className="reconcile-time-grid">
            <label><span>Started</span><input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label>
            <label><span>Ended</span><input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></label>
          </div>
          {plan.people.length > 0 && (
            <fieldset>
              <legend>Who was actually there?</legend>
              {plan.people.map(person => (
                <label key={person.id} className="capture-person-option">
                  <input
                    type="checkbox"
                    checked={personIds.includes(person.id)}
                    onChange={event => setPersonIds(current => event.target.checked
                      ? [...current, person.id]
                      : current.filter(id => id !== person.id))}
                  />
                  <span>{person.name}</span>
                </label>
              ))}
            </fieldset>
          )}
          <label>
            <span>Place</span>
            <select value={placeId} onChange={event => setPlaceId(event.target.value)}>
              <option value="">No place</option>
              {places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
            </select>
          </label>
          <div className="reconcile-time-grid">
            <label><span>Outcome</span><input value={outcome} onChange={event => setOutcome(event.target.value)} placeholder="Complete, follow-up needed…" /></label>
            <label>
              <span>How did it feel?</span>
              <select value={emotionalWeight} onChange={event => setEmotionalWeight(event.target.value)}>
                <option value="">Not recorded</option>
                <option>Energizing</option><option>Positive</option><option>Neutral</option><option>Draining</option><option>Stressful</option>
              </select>
            </label>
          </div>
          <label><span>Follow-ups, one per line</span><textarea rows={2} value={followUps} onChange={event => setFollowUps(event.target.value)} /></label>
          <label><span>Add note</span><textarea rows={2} value={note} onChange={event => setNote(event.target.value)} /></label>
          <button type="button" className="capture-submit" disabled={busy || !title.trim() || !start} onClick={() => reconcile("changed")}>
            Save what happened
          </button>
        </div>
      )}
      {error && <div className="capture-analysis-status error" role="alert">{error}</div>}
    </article>
  )
}

function toLocal(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  })
}
