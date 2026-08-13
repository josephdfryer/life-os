"use client"

import { useState } from "react"

type Outcome = "helpful" | "not_helpful" | "not_sure"

const OPTIONS: { value: Outcome; label: string }[] = [
  { value: "helpful", label: "Helpful" },
  { value: "not_helpful", label: "Not helpful" },
  { value: "not_sure", label: "Not sure" },
]

export default function OutcomeQuestionCard({ intervention }: { intervention: { id: string; recommendationText: string; category: string } }) {
  const [note, setNote] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [chosen, setChosen] = useState<Outcome | null>(null)

  async function submit(outcome: Outcome) {
    setChosen(outcome)
    setStatus("saving")
    const res = await fetch(`/api/adaptive-day/interventions/${intervention.id}/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome, note: note.trim() || undefined }),
    })
    setStatus(res.ok ? "saved" : "error")
  }

  if (status === "saved") {
    return (
      <section className="day-checkin">
        <div className="quick-capture-eyebrow">Follow-up</div>
        <div className="capture-analysis-status">Thanks — noted.</div>
      </section>
    )
  }

  return (
    <section className="day-checkin">
      <div className="quick-capture-eyebrow">One quick follow-up</div>
      <h2>Did this adjustment help?</h2>
      <div style={{ fontSize: "12px", color: "var(--ink-3)", margin: "-8px 0 16px" }}>
        {intervention.recommendationText}
      </div>
      <div className="checkin-actions" style={{ flexWrap: "wrap" }}>
        {OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={chosen === opt.value ? "capture-submit" : "capture-secondary"}
            disabled={status === "saving"}
            onClick={() => submit(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <label className="checkin-note">
        <span>Anything worth remembering? (optional)</span>
        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
      </label>
      {status === "error" && <div className="capture-analysis-status error">Couldn't save that — try again.</div>}
    </section>
  )
}
