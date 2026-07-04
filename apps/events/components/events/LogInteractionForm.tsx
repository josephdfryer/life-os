"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

type Person = {
  id: string
  first: string
  last: string | null
}

const EMOTIONAL_WEIGHTS = ["Energizing", "Positive", "Neutral", "Draining", "Stressful"]
const OUTCOMES = ["Complete", "Follow-up needed", "Action required", "Open"]
const TYPES = ["meeting", "call", "message", "dinner", "in-person", "other"]

type Props = {
  eventId: string
  eventStart: string
  defaultType: string
}

export default function LogInteractionForm({ eventId, eventStart, defaultType }: Props) {
  const router = useRouter()
  const [people, setPeople] = useState<Person[]>([])
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    personId: "",
    type: defaultType,
    emotionalWeight: "Neutral",
    outcome: "Complete",
    summary: "",
    notes: "",
  })

  useEffect(() => {
    fetch("/api/people")
      .then((res) => res.json())
      .then((data) => setPeople(Array.isArray(data) ? data : []))
      .catch(() => setPeople([]))
  }, [])

  function setField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.personId) {
      setError("Choose a person")
      return
    }

    startTransition(async () => {
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          timestamp: eventStart,
          ...form,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message ?? data?.error ?? "Failed to log interaction")
        return
      }
      router.refresh()
      setForm((current) => ({ ...current, personId: "", summary: "", notes: "" }))
    })
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "12px" }}>
      <div>
        <label style={labelStyle}>Person</label>
        <select
          value={form.personId}
          onChange={(e) => setField("personId", e.target.value)}
          style={inputStyle}
          required
        >
          <option value="">Select person…</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.first} {person.last ?? ""}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div>
          <label style={labelStyle}>Type</label>
          <select value={form.type} onChange={(e) => setField("type", e.target.value)} style={inputStyle}>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Emotional weight</label>
          <select
            value={form.emotionalWeight}
            onChange={(e) => setField("emotionalWeight", e.target.value)}
            style={inputStyle}
          >
            {EMOTIONAL_WEIGHTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label style={labelStyle}>Outcome</label>
        <select value={form.outcome} onChange={(e) => setField("outcome", e.target.value)} style={inputStyle}>
          {OUTCOMES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>Summary</label>
        <input
          value={form.summary}
          onChange={(e) => setField("summary", e.target.value)}
          style={inputStyle}
          placeholder="How it landed for them"
        />
      </div>

      <div>
        <label style={labelStyle}>Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>

      {error && <div style={{ fontSize: "12px", color: "#f87171" }}>{error}</div>}

      <button
        type="submit"
        disabled={isPending}
        style={{
          justifySelf: "start",
          background: "var(--accent)",
          color: "#0d0d0d",
          border: "none",
          borderRadius: "8px",
          padding: "8px 16px",
          fontSize: "12px",
          fontWeight: 600,
          cursor: isPending ? "wait" : "pointer",
          opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending ? "Saving…" : "Log interaction"}
      </button>
    </form>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--ink-3)",
  display: "block",
  marginBottom: "4px",
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "8px 12px",
  fontSize: "13px",
  color: "var(--ink)",
  fontFamily: "inherit",
  outline: "none",
}