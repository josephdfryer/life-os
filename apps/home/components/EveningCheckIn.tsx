"use client"

import { useState } from "react"

export default function EveningCheckIn() {
  const [values, setValues] = useState({ energy: 3, mood: 3, stress: 3 })
  const [note, setNote] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [message, setMessage] = useState("")

  async function save() {
    setStatus("saving")
    const response = await fetch("/api/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values, note }),
    })
    const body = await response.json().catch(() => null) as { error?: string } | null
    if (!response.ok) {
      setStatus("error")
      setMessage(body?.error || "Check-in could not be saved")
      return
    }
    setStatus("saved")
    setMessage("Evening State recorded.")
    setNote("")
  }

  return (
    <section className="evening-checkin">
      <div className="quick-capture-eyebrow">Evening closeout</div>
      <h2>How are you ending the day?</h2>
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
          {status === "saving" ? "Saving…" : "Close out"}
        </button>
        <button type="button" className="capture-secondary" onClick={() => setMessage("Skipped for tonight.")}>Not tonight</button>
      </div>
      {message && <div className={status === "error" ? "capture-analysis-status error" : "capture-analysis-status"}>{message}</div>}
    </section>
  )
}
