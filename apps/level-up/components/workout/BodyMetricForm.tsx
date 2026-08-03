"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { logBodyMetric } from "@/lib/workout/actions"
import { lbToKg, type Unit } from "@/lib/workout/units"

// ─────────────────────────────────────────────
// BODY METRICS
//
// Its own screen on purpose. Weighing yourself is a different act from logging
// a set — different cadence, different mood — and folding it into the session
// logger would put a second priority on the one screen that cannot have one.
// ─────────────────────────────────────────────

export default function BodyMetricForm({ unit }: { unit: Unit }) {
  const router = useRouter()
  const [weight, setWeight] = useState("")
  const [bodyFat, setBodyFat] = useState("")
  const [muscle, setMuscle] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const parsed = {
    weight: weight.trim() === "" ? null : Number(weight),
    bodyFat: bodyFat.trim() === "" ? null : Number(bodyFat),
    muscle: muscle.trim() === "" ? null : Number(muscle),
  }
  const anything = Object.values(parsed).some(value => value !== null)
  const valid = Object.values(parsed).every(value => value === null || Number.isFinite(value))

  async function save() {
    if (!anything || !valid) {
      setError("Enter at least one number.")
      return
    }
    setSaving(true)
    setError("")
    try {
      await logBodyMetric({
        weightKg: parsed.weight === null ? null : unit === "kg" ? parsed.weight : lbToKg(parsed.weight),
        bodyFatPct: parsed.bodyFat,
        musclePct: parsed.muscle,
      })
      setWeight("")
      setBodyFat("")
      setMuscle("")
      router.refresh()
    } catch {
      setError("That did not save. Check your connection.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="metric-field">
        <label htmlFor="metric-weight">Weight ({unit})</label>
        <input
          id="metric-weight"
          inputMode="decimal"
          onChange={event => setWeight(event.target.value)}
          placeholder="—"
          value={weight}
        />
      </div>
      <div className="metric-field">
        <label htmlFor="metric-fat">Body fat %</label>
        <input
          id="metric-fat"
          inputMode="decimal"
          onChange={event => setBodyFat(event.target.value)}
          placeholder="—"
          value={bodyFat}
        />
      </div>
      <div className="metric-field">
        <label htmlFor="metric-muscle">Muscle %</label>
        <input
          id="metric-muscle"
          inputMode="decimal"
          onChange={event => setMuscle(event.target.value)}
          placeholder="—"
          value={muscle}
        />
      </div>

      {error && <div className="session-error" style={{ borderTop: 0 }}>{error}</div>}

      <button className="start-button" disabled={saving || !anything} onClick={() => void save()}>
        {saving ? "Saving…" : "Log"}
      </button>
    </div>
  )
}
