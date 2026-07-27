"use client"

import { useState } from "react"

export default function WeeklyReviewActions() {
  const [plan, setPlan] = useState("")
  const [message, setMessage] = useState("")

  async function act(action: "feedback" | "plan", text: string) {
    const response = await fetch("/api/weekly-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, text }),
    })
    const body = await response.json().catch(() => null) as { error?: string } | null
    setMessage(response.ok ? "Saved." : body?.error || "Could not save")
    if (response.ok && action === "plan") setPlan("")
  }

  return (
    <div className="weekly-actions">
      <div>
        <span>Was this useful?</span>
        <button type="button" onClick={() => act("feedback", "useful")}>Useful</button>
        <button type="button" onClick={() => act("feedback", "not-useful")}>Not useful</button>
      </div>
      <div>
        <input value={plan} onChange={event => setPlan(event.target.value)} placeholder="Carry something into next week…" />
        <button type="button" className="capture-submit" disabled={!plan.trim()} onClick={() => act("plan", plan)}>Create Plan</button>
      </div>
      {message && <small>{message}</small>}
    </div>
  )
}
