"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

const EVENT_TYPES = ["meeting", "call", "dinner", "trip", "milestone", "calendar", "message", "other"]

export default function NewEventPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const now = new Date()
  const defaultStart = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    const body: Record<string, unknown> = {}
    for (const [key, val] of formData.entries()) {
      if (val !== "") body[key] = val
    }

    startTransition(async () => {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to create event")
        return
      }
      const created = await res.json()
      router.push(`/events/${created.id}`)
    })
  }

  const labelStyle: React.CSSProperties = { fontSize: "11px", color: "var(--ink-3)", display: "block", marginBottom: "4px" }
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
  const fieldStyle: React.CSSProperties = { marginBottom: "16px" }

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ marginBottom: "32px" }}>
        <a href="/events" style={{ fontSize: "12px", color: "var(--ink-3)", textDecoration: "none" }}>
          ← Timeline
        </a>
      </div>

      <h1
        style={{
          fontFamily: "var(--font-playfair)",
          fontSize: "24px",
          fontWeight: 600,
          margin: "0 0 28px",
          letterSpacing: "-0.02em",
        }}
      >
        New event
      </h1>

      <form onSubmit={handleSubmit}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Name *</label>
          <input name="name" required style={inputStyle} placeholder="Dinner with Alex" />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Type *</label>
          <select name="type" required defaultValue="meeting" style={inputStyle}>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
          <div>
            <label style={labelStyle}>Start *</label>
            <input name="start" type="datetime-local" required defaultValue={defaultStart} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>End</label>
            <input name="end" type="datetime-local" style={inputStyle} />
          </div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Notes</label>
          <textarea name="notes" rows={4} style={{ ...inputStyle, resize: "vertical" }} placeholder="What happened or what to expect…" />
        </div>

        {error && (
          <div style={{ fontSize: "12px", color: "#f87171", marginBottom: "16px" }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={isPending}
          style={{
            background: "var(--accent)",
            color: "#0d0d0d",
            border: "none",
            borderRadius: "8px",
            padding: "10px 20px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: isPending ? "wait" : "pointer",
            opacity: isPending ? 0.7 : 1,
          }}
        >
          {isPending ? "Creating…" : "Create event"}
        </button>
      </form>
    </div>
  )
}