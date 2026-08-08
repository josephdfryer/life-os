"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type ApiErrorEnvelope = { error?: string | { message?: string } }

export function LifeModelRegenerator({ hasSnapshot }: { hasSnapshot: boolean }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function regenerate() {
    if (busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch("/api/life-model/regenerate", { method: "POST" })
      const body = await response.json().catch(() => ({})) as ApiErrorEnvelope
      if (!response.ok) throw new Error(apiError(body, "The whole-life reading could not be generated."))
      setConfirming(false)
      setMessage("A new whole-life reading was saved.")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The whole-life reading could not be generated.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="life-model-regenerator">
      {confirming ? (
        <div className="theory-regenerator-confirm" role="group" aria-label="Confirm whole-life regeneration">
          <div>
            <strong>Generate a fresh whole-life reading?</strong>
            <p>This makes a billed AI Gateway call across bounded graph evidence and saves a new version. Existing versions remain available.</p>
          </div>
          <div>
            <button className="still-button still-button-secondary" type="button" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
            <button className="still-button still-button-primary" type="button" onClick={() => void regenerate()} disabled={busy}>{busy ? "Synthesizing…" : "Run synthesis"}</button>
          </div>
        </div>
      ) : (
        <button className="still-button still-button-primary" type="button" onClick={() => setConfirming(true)} disabled={busy}>
          {hasSnapshot ? "Regenerate whole-life reading" : "Generate whole-life reading"}
        </button>
      )}
      <div className="theory-regenerator-feedback" aria-live="polite">
        {error ? <p className="theory-regenerator-error">{error}</p> : null}
        {message ? <p className="theory-regenerator-success">{message}</p> : null}
      </div>
    </div>
  )
}

export function ClaimFeedbackControls({ claimId, statement }: { claimId: string; statement: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<"idle" | "correct" | "dismiss">("idle")
  const [replacement, setReplacement] = useState(statement)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(action: "dismiss" | "correct") {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/life-model/claims/${encodeURIComponent(claimId)}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "correct" ? { action, replacementStatement: replacement } : { action }),
      })
      const body = await response.json().catch(() => ({})) as ApiErrorEnvelope
      if (!response.ok) throw new Error(apiError(body, `The claim could not be ${action === "correct" ? "corrected" : "dismissed"}.`))
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The feedback could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="claim-feedback-controls">
      {mode === "correct" ? (
        <div className="claim-correction-form">
          <label htmlFor={`claim-correction-${claimId}`}>What is more accurate?</label>
          <textarea id={`claim-correction-${claimId}`} value={replacement} onChange={event => setReplacement(event.target.value)} rows={3} maxLength={4000} disabled={busy} />
          <div>
            <button className="still-button still-button-secondary" type="button" onClick={() => setMode("idle")} disabled={busy}>Cancel</button>
            <button className="still-button still-button-primary" type="button" onClick={() => void submit("correct")} disabled={busy || !replacement.trim()}>{busy ? "Saving…" : "Save correction"}</button>
          </div>
        </div>
      ) : mode === "dismiss" ? (
        <div className="claim-dismiss-confirm" role="group" aria-label="Confirm claim dismissal">
          <p>Hide this claim from the current reading? The original claim and this feedback remain in history.</p>
          <div>
            <button className="still-button still-button-secondary" type="button" onClick={() => setMode("idle")} disabled={busy}>Cancel</button>
            <button className="still-button still-button-primary" type="button" onClick={() => void submit("dismiss")} disabled={busy}>{busy ? "Saving…" : "Dismiss claim"}</button>
          </div>
        </div>
      ) : (
        <div className="claim-feedback-actions">
          <button type="button" onClick={() => setMode("correct")} disabled={busy}>Correct this</button>
          <button type="button" onClick={() => setMode("dismiss")} disabled={busy}>Dismiss</button>
        </div>
      )}
      {error ? <p className="theory-regenerator-error" role="alert">{error}</p> : null}
    </div>
  )
}

function apiError(body: ApiErrorEnvelope, fallback: string): string {
  if (typeof body.error === "string" && body.error.trim()) return body.error
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string" && body.error.message.trim()) return body.error.message
  return fallback
}
