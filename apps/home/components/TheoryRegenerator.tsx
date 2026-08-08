"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export type TheoryPersonOption = {
  id: string
  name: string
  version: number | null
  synthesizedAt: string | null
}

type ApiErrorEnvelope = { error?: string | { message?: string } }

export function TheoryRegenerator({ people }: { people: TheoryPersonOption[] }) {
  const router = useRouter()
  const [personId, setPersonId] = useState(people[0]?.id ?? "")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = people.find(person => person.id === personId) ?? null

  function choosePerson(nextPersonId: string) {
    setPersonId(nextPersonId)
    setConfirming(false)
    setMessage(null)
    setError(null)
  }

  async function regenerate() {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`/api/theory/${encodeURIComponent(selected.id)}/regenerate`, { method: "POST" })
      const body = await response.json().catch(() => ({})) as ApiErrorEnvelope & { snapshotId?: string }
      if (!response.ok) throw new Error(errorMessage(body))
      setConfirming(false)
      setMessage(`A new Theory of ${selected.name} was saved.`)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The theory could not be regenerated.")
    } finally {
      setBusy(false)
    }
  }

  if (people.length === 0) {
    return <div className="stream-message">Add a person before generating a person-level theory.</div>
  }

  return (
    <div className="theory-regenerator">
      <div className="theory-regenerator-controls">
        <label>
          <span>Person</span>
          <select value={personId} onChange={event => choosePerson(event.target.value)} disabled={busy}>
            {people.map(person => (
              <option value={person.id} key={person.id}>
                {person.name}{person.version === null ? " · no theory yet" : ` · v${person.version}`}
              </option>
            ))}
          </select>
        </label>
        <div className="theory-regenerator-status">
          <span>Current model</span>
          <strong>{selected?.version == null ? "Not synthesized" : `Version ${selected.version}`}</strong>
          <small>{selected?.synthesizedAt ? formatDate(selected.synthesizedAt) : "No saved reading"}</small>
        </div>
      </div>

      {confirming && selected ? (
        <div className="theory-regenerator-confirm" role="group" aria-label="Confirm theory regeneration">
          <div>
            <strong>Generate a fresh Theory of {selected.name}?</strong>
            <p>This makes a billed AI Gateway call against current evidence and saves a new, versioned snapshot. Existing versions remain available.</p>
          </div>
          <div>
            <button className="still-button still-button-secondary" type="button" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
            <button className="still-button still-button-primary" type="button" onClick={() => void regenerate()} disabled={busy}>
              {busy ? "Synthesizing…" : "Run synthesis"}
            </button>
          </div>
        </div>
      ) : (
        <div className="theory-regenerator-actions">
          <button className="still-button still-button-primary" type="button" onClick={() => setConfirming(true)} disabled={!selected || busy}>
            {selected?.version == null ? "Generate theory" : "Regenerate theory"}
          </button>
          {selected ? <a href={`https://theory.lacollecteur.com/person/${encodeURIComponent(selected.id)}`}>Open full theory ↗</a> : null}
        </div>
      )}

      <div className="theory-regenerator-feedback" aria-live="polite">
        {error ? <p className="theory-regenerator-error">{error}</p> : null}
        {message ? <p className="theory-regenerator-success">{message}</p> : null}
      </div>
    </div>
  )
}

export function errorMessage(body: ApiErrorEnvelope) {
  if (typeof body.error === "string" && body.error.trim()) return body.error
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string" && body.error.message.trim()) {
    return body.error.message
  }
  return "The theory could not be regenerated."
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value))
}
