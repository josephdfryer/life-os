"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { logTrainingSet } from "@/lib/actions"
import type { SetRating } from "@/lib/engine/training"

type Exercise = { key: string; label: string; hasNorm: boolean }
type PreviousSet = { exerciseKey: string; reps: number; loadKg: number }
type LoggedLine = SetRating & {
  id: number
  exerciseKey: string
  exerciseLabel: string
  reps: number
  loadKg: number
}

const REST_SECONDS = [60, 90, 120, 180]

export default function TrainLogger({
  exercises,
  defaultBodyweight,
  previousSets,
}: {
  exercises: Exercise[]
  defaultBodyweight: number | null
  previousSets: PreviousSet[]
}) {
  const previousByExercise = useMemo(
    () => new Map(previousSets.map((set) => [set.exerciseKey, set])),
    [previousSets],
  )
  const [exerciseKey, setExerciseKey] = useState(exercises[0]?.key ?? "")
  const [reps, setReps] = useState("5")
  const [load, setLoad] = useState("")
  const [bw, setBw] = useState(defaultBodyweight ? String(defaultBodyweight) : "")
  const [sessionId] = useState(() => `s_${Date.now()}`)
  const [sessionStartedAt] = useState(() => Date.now())
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [restDuration, setRestDuration] = useState(90)
  const [restRemaining, setRestRemaining] = useState(0)
  const [log, setLog] = useState<LoggedLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const selected = exercises.find((exercise) => exercise.key === exerciseKey)
  const previous = previousByExercise.get(exerciseKey)
  const totalVolume = log.reduce((sum, set) => sum + set.loadKg * set.reps, 0)
  const progress = restDuration > 0 ? Math.max(0, Math.min(1, restRemaining / restDuration)) : 0

  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - sessionStartedAt) / 1000)),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [sessionStartedAt])

  useEffect(() => {
    if (restRemaining <= 0) return
    const timer = window.setInterval(() => {
      setRestRemaining((remaining) => Math.max(0, remaining - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [restRemaining > 0])

  function chooseExercise(key: string) {
    setExerciseKey(key)
    const last = previousByExercise.get(key)
    if (last) {
      setLoad(String(last.loadKg))
      setReps(String(last.reps))
    } else {
      setLoad("")
      setReps("5")
    }
  }

  function adjust(field: "load" | "reps", amount: number) {
    if (field === "load") {
      setLoad(String(Math.max(0, (Number.parseFloat(load) || 0) + amount)))
    } else {
      setReps(String(Math.max(1, (Number.parseInt(reps, 10) || 0) + amount)))
    }
  }

  function submit() {
    const parsedReps = Number.parseInt(reps, 10)
    const parsedLoad = Number.parseFloat(load)
    const parsedBodyweight = Number.parseFloat(bw)
    if (!Number.isFinite(parsedReps) || !Number.isFinite(parsedLoad) || !Number.isFinite(parsedBodyweight)) {
      setError("Add your load, reps, and bodyweight to log this set.")
      return
    }
    setError(null)
    start(async () => {
      try {
        const rated = await logTrainingSet({
          exerciseKey,
          reps: parsedReps,
          loadKg: parsedLoad,
          bodyweightKg: parsedBodyweight,
          sessionId,
        })
        setLog((current) => [{
          ...rated,
          id: Date.now(),
          exerciseKey,
          exerciseLabel: selected?.label ?? exerciseKey,
          reps: parsedReps,
          loadKg: parsedLoad,
        }, ...current])
        setRestRemaining(restDuration)
      } catch {
        setError("That set did not save. Check your connection and try again.")
      }
    })
  }

  return (
    <div className="workout-shell">
      <section className="workout-hero">
        <div>
          <div className="eyebrow">Live workout</div>
          <h1>Training floor</h1>
          <p>Log the honest work. Your verified combine remains the ceiling.</p>
        </div>
        <div className="session-clock">
          <span>{formatTime(elapsedSeconds)}</span>
          <small>{log.length} sets · {Math.round(totalVolume).toLocaleString()} kg</small>
        </div>
      </section>

      <section className="exercise-picker" aria-label="Choose an exercise">
        {exercises.map((exercise) => (
          <button
            className={exercise.key === exerciseKey ? "exercise-pill active" : "exercise-pill"}
            key={exercise.key}
            onClick={() => chooseExercise(exercise.key)}
          >
            <span>{exercise.label}</span>
            <small>{exercise.hasNorm ? "Rank + balance" : "Balance"}</small>
          </button>
        ))}
      </section>

      <section className="live-lift-card">
        <header className="live-lift-header">
          <div>
            <div className="eyebrow">Current movement</div>
            <h2>{selected?.label ?? "Choose a movement"}</h2>
          </div>
          <div className="set-count">Set {log.filter((set) => set.exerciseKey === exerciseKey).length + 1}</div>
        </header>

        <div className="previous-strip">
          <span>Last performance</span>
          <strong>{previous ? `${previous.loadKg} kg × ${previous.reps}` : "First set on record"}</strong>
        </div>

        <div className="set-input-grid">
          <NumberControl
            label="Weight"
            value={load}
            unit="kg"
            inputMode="decimal"
            onChange={setLoad}
            onDown={() => adjust("load", -2.5)}
            onUp={() => adjust("load", 2.5)}
          />
          <NumberControl
            label="Reps"
            value={reps}
            inputMode="numeric"
            onChange={setReps}
            onDown={() => adjust("reps", -1)}
            onUp={() => adjust("reps", 1)}
          />
        </div>

        <details className="workout-details">
          <summary>Session settings</summary>
          <label>
            Bodyweight
            <span><input inputMode="decimal" value={bw} onChange={(event) => setBw(event.target.value)} /> kg</span>
          </label>
          <label>
            Rest after set
            <span className="rest-options">
              {REST_SECONDS.map((seconds) => (
                <button
                  className={restDuration === seconds ? "active" : ""}
                  key={seconds}
                  onClick={() => setRestDuration(seconds)}
                  type="button"
                >
                  {seconds < 60 ? seconds : `${seconds / 60}m`}
                </button>
              ))}
            </span>
          </label>
        </details>

        {error && <div className="workout-error" role="alert">{error}</div>}
        <button className="complete-set-button" disabled={pending} onClick={submit}>
          <span>{pending ? "Saving…" : "Complete set"}</span>
          <small>{load || "0"} kg × {reps || "0"}</small>
        </button>
      </section>

      {(restRemaining > 0 || log.length > 0) && (
        <section className={restRemaining > 0 ? "rest-card active" : "rest-card"}>
          <div className="rest-ring" style={{ "--rest-progress": `${progress * 360}deg` } as React.CSSProperties}>
            <div><strong>{formatTime(restRemaining)}</strong><span>rest</span></div>
          </div>
          <div className="rest-copy">
            <div className="eyebrow">{restRemaining > 0 ? "Recovery interval" : "Ready"}</div>
            <h3>{restRemaining > 0 ? "Breathe. Reset. Own the next set." : "Your next set is waiting."}</h3>
            <div className="rest-actions">
              <button onClick={() => setRestRemaining((value) => value + 30)}>+30 sec</button>
              <button onClick={() => setRestRemaining(0)}>Skip</button>
            </div>
          </div>
        </section>
      )}

      <section className="workout-log">
        <div className="workout-section-heading">
          <div>
            <div className="eyebrow">Quest log</div>
            <h2>Today’s work</h2>
          </div>
          {log.some((set) => set.isPr) && <span className="pr-badge">PR earned</span>}
        </div>
        {log.length === 0 ? (
          <div className="workout-empty">
            <strong>Your first set starts the session.</strong>
            <span>Previous numbers stay visible so logging takes seconds, not attention.</span>
          </div>
        ) : (
          log.map((set, index) => (
            <article className="logged-set" key={set.id}>
              <div className="logged-set-index">{log.length - index}</div>
              <div className="logged-set-main">
                <strong>{set.exerciseLabel}</strong>
                <span>{set.loadKg} kg × {set.reps} · e1RM {set.e1rm} kg</span>
                <small>{set.balanceLabel ?? set.suppressedRankReason}</small>
              </div>
              <div className="logged-set-score">
                {set.isPr && <span className="pr-mark">PR</span>}
                {set.rank != null ? (
                  <><strong>{set.rank}</strong><span>{set.rankLetter} rank</span></>
                ) : set.balance != null ? (
                  <><strong>{set.balance >= 0 ? "+" : ""}{set.balance}</strong><span>balance</span></>
                ) : (
                  <span>Logged</span>
                )}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  )
}

function NumberControl({
  label,
  value,
  unit,
  inputMode,
  onChange,
  onDown,
  onUp,
}: {
  label: string
  value: string
  unit?: string
  inputMode: "numeric" | "decimal"
  onChange: (value: string) => void
  onDown: () => void
  onUp: () => void
}) {
  return (
    <div className="number-control">
      <label>{label}</label>
      <div>
        <button onClick={onDown} type="button" aria-label={`Decrease ${label}`}>−</button>
        <span className="number-input">
          <input inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} placeholder="0" />
          {unit && <small>{unit}</small>}
        </span>
        <button onClick={onUp} type="button" aria-label={`Increase ${label}`}>+</button>
      </div>
    </div>
  )
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
