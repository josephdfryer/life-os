"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type PersonOption = { id: string; first: string; last: string; headline: string | null }

export function MentionReviewControls({ mentionId, currentName }: { mentionId: string; currentName?: string }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [people, setPeople] = useState<PersonOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function search(value: string) {
    setQuery(value)
    if (value.trim().length < 2) return setPeople([])
    const response = await fetch(`/api/files/people?q=${encodeURIComponent(value)}`)
    if (response.ok) setPeople((await response.json()).people ?? [])
  }
  async function update(action: "resolve" | "not_this_person", personId?: string) {
    setBusy(true); setError("")
    const response = await fetch(`/api/files/mentions/${mentionId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, personId }) })
    setBusy(false)
    if (!response.ok) return setError((await response.json()).error ?? "Could not update identity")
    setQuery(""); setPeople([]); router.refresh()
  }
  return <div style={{ marginTop: 8 }}>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <label style={srOnly} htmlFor={`person-${mentionId}`}>Find the correct Person for {currentName ?? "this mention"}</label>
      <input id={`person-${mentionId}`} value={query} onChange={event => search(event.target.value)} placeholder="Find correct Person…" style={inputStyle} disabled={busy} />
      {currentName ? <button type="button" onClick={() => update("not_this_person")} disabled={busy} style={buttonStyle}>Not actually this person</button> : null}
    </div>
    {people.length ? <div role="listbox" aria-label="Matching people" style={{ border: "1px solid var(--border-subtle)", marginTop: 4, borderRadius: 8 }}>
      {people.map(person => <button type="button" role="option" aria-selected="false" key={person.id} onClick={() => update("resolve", person.id)} style={{ ...optionStyle, display: "block", width: "100%" }}>{person.first} {person.last}{person.headline ? ` — ${person.headline}` : ""}</button>)}
    </div> : null}
    {error ? <div role="alert" style={{ color: "var(--danger, #9b2c2c)", fontSize: 11 }}>{error}</div> : null}
  </div>
}

export function ClaimReviewControls({ claimId, status, assertion, canUndo }: { claimId: string; status: string; assertion: string; canUndo: boolean }) {
  const router = useRouter()
  const [correction, setCorrection] = useState(assertion)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function update(action: "accept" | "dismiss" | "correct" | "undo") {
    setBusy(true); setError("")
    const response = await fetch(`/api/files/claims/${claimId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, assertion: correction }) })
    setBusy(false)
    if (!response.ok) return setError((await response.json()).error ?? "Could not review claim")
    setEditing(false); router.refresh()
  }
  return <div style={{ marginTop: 10 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {status === "unreviewed" ? <><button type="button" disabled={busy} style={buttonStyle} onClick={() => update("accept")}>Accept</button><button type="button" disabled={busy} style={buttonStyle} onClick={() => update("dismiss")}>Dismiss</button><button type="button" disabled={busy} style={buttonStyle} onClick={() => setEditing(value => !value)}>Correct</button></> : null}
      {canUndo && status !== "reversed" ? <button type="button" disabled={busy} style={buttonStyle} onClick={() => update("undo")}>Undo graph write</button> : null}
    </div>
    {editing ? <div style={{ display: "flex", gap: 6, marginTop: 6 }}><label htmlFor={`correction-${claimId}`} style={srOnly}>Corrected assertion</label><input id={`correction-${claimId}`} value={correction} onChange={event => setCorrection(event.target.value)} style={{ ...inputStyle, flex: 1 }} /><button type="button" disabled={busy || !correction.trim()} style={buttonStyle} onClick={() => update("correct")}>Save correction</button></div> : null}
    {error ? <div role="alert" style={{ color: "var(--danger, #9b2c2c)", fontSize: 11 }}>{error}</div> : null}
  </div>
}

const buttonStyle: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: "5px 9px", background: "transparent", color: "var(--ink-3)", font: "inherit", fontSize: 10 }
const inputStyle: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", background: "var(--surface)", color: "var(--ink)", font: "inherit", fontSize: 11 }
const optionStyle: React.CSSProperties = { border: 0, borderTop: "1px solid var(--border-subtle)", padding: "7px 9px", background: "var(--surface)", color: "var(--ink-2)", textAlign: "left", font: "inherit", fontSize: 11 }
const srOnly: React.CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }
