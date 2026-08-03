"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { startSession } from "@/lib/workout/actions"

// ─────────────────────────────────────────────
// SESSION START
//
// Pick the day, declare what hurts, go. The flare toggles are one tap and sit
// above the day list because they change what the day contains — the brief is
// right that this is worth more than any analytics screen, and it only works
// if it costs nothing to use.
// ─────────────────────────────────────────────

type Day = {
  id: string
  name: string
  entries: {
    id: string
    targetSets: number
    targetReps: number | null
    targetDurationSec: number | null
    exercise: { label: string; modality: string }
  }[]
}

export default function StartSession({ days }: { days: Day[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState(days[0]?.id ?? "")
  const [knee, setKnee] = useState(false)
  const [lumbar, setLumbar] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState("")

  async function begin() {
    if (!selected) return
    setStarting(true)
    setError("")
    try {
      const session = await startSession({
        programDayId: selected,
        kneeFlare: knee,
        lumbarFlare: lumbar,
      })
      const params = new URLSearchParams({
        session: session.id,
        started: session.startedAt,
        day: selected,
        ...(knee ? { knee: "1" } : {}),
        ...(lumbar ? { lumbar: "1" } : {}),
      })
      router.push(`/train/session?${params.toString()}`)
    } catch {
      setError("Could not start the session. Check your connection.")
      setStarting(false)
    }
  }

  return (
    <div className="start-shell">
      <div className="mono" style={{ marginBottom: 10 }}>Today</div>

      <button
        className={knee ? "flare-toggle on" : "flare-toggle"}
        onClick={() => setKnee(value => !value)}
      >
        <span>
          <strong>Knee is cranky today</strong>
          <small>Swaps squats and jumps for hip-dominant work</small>
        </span>
        <span className="flare-state">{knee ? "On" : "Off"}</span>
      </button>

      <button
        className={lumbar ? "flare-toggle on" : "flare-toggle"}
        onClick={() => setLumbar(value => !value)}
      >
        <span>
          <strong>Back is loaded up</strong>
          <small>Swaps spinal compression for unloaded trunk work</small>
        </span>
        <span className="flare-state">{lumbar ? "On" : "Off"}</span>
      </button>

      <div className="mono" style={{ margin: "24px 0 10px" }}>Day</div>
      {days.length === 0 ? (
        <div className="empty-note">No program days yet.</div>
      ) : (
        days.map(day => (
          <button
            className={day.id === selected ? "day-card selected" : "day-card"}
            key={day.id}
            onClick={() => setSelected(day.id)}
          >
            <h3>{day.name}</h3>
            <div className="day-card-entries">
              {day.entries.map(entry => (
                <div key={entry.id}>
                  {entry.exercise.label} · {entry.targetSets} ×{" "}
                  {entry.exercise.modality === "duration"
                    ? `${entry.targetDurationSec ?? 45}s`
                    : entry.targetReps ?? 5}
                </div>
              ))}
            </div>
          </button>
        ))
      )}

      {error && <div className="session-error" style={{ borderTop: 0 }}>{error}</div>}

      <button className="start-button" disabled={!selected || starting} onClick={() => void begin()}>
        {starting ? "Starting…" : "Start session"}
      </button>
    </div>
  )
}
