"use client"

import { useState } from "react"

type Slot = "morning" | "evening"

const COPY: Record<Slot, { eyebrow: string; heading: string; savedMessage: string; submitLabel: string; skipLabel: string; skipMessage: string }> = {
  morning: {
    eyebrow: "Morning check-in",
    heading: "How are you starting the day?",
    savedMessage: "Morning State recorded.",
    submitLabel: "Start the day",
    skipLabel: "Not now",
    skipMessage: "Skipped for this morning.",
  },
  evening: {
    eyebrow: "Evening closeout",
    heading: "How are you ending the day?",
    savedMessage: "Evening State recorded.",
    submitLabel: "Close out",
    skipLabel: "Not tonight",
    skipMessage: "Skipped for tonight.",
  },
}

export default function CheckIn({ slot }: { slot: Slot }) {
  const [values, setValues] = useState({ energy: 3, mood: 3, stress: 3 })
  const [note, setNote] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [message, setMessage] = useState("")
  const copy = COPY[slot]

  async function save() {
    setStatus("saving")
    const response = await fetch("/api/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values, note, slot }),
    })
    const body = await response.json().catch(() => null) as { error?: string } | null
    if (!response.ok) {
      setStatus("error")
      setMessage(body?.error || "Check-in could not be saved")
      return
    }
    setStatus("saved")
    setMessage(copy.savedMessage)
    setNote("")
  }

  return (
    <section className="day-checkin">
      <div className="quick-capture-eyebrow">{copy.eyebrow}</div>
      <h2>{copy.heading}</h2>
      <div className="checkin-scales">
        {(["energy", "mood", "stress"] as const).map(type => (
          <label key={type}>
            <span>{type}</span>
            <input
              type="range"
              min="1"
              max="5"
              value={values[type]}
              onChange={event => setValues(current => ({ ...current, [type]: Number(event.target.value) }))}
            />
            <strong>{values[type]}</strong>
          </label>
        ))}
      </div>
      <label className="checkin-note">
        <span>Anything worth remembering?</span>
        <textarea rows={2} value={note} onChange={event => setNote(event.target.value)} />
      </label>
      <div className="checkin-actions">
        <button type="button" className="capture-submit" disabled={status === "saving"} onClick={save}>
          {status === "saving" ? "Saving…" : copy.submitLabel}
        </button>
        <button type="button" className="capture-secondary" onClick={() => setMessage(copy.skipMessage)}>{copy.skipLabel}</button>
      </div>
      {message && <div className={status === "error" ? "capture-analysis-status error" : "capture-analysis-status"}>{message}</div>}
    </section>
  )
}
