"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import WheelPicker, { type WheelOption } from "./WheelPicker"
import { endSession, logSet, type LoggedSet } from "@/lib/workout/actions"
import type { PreparedEntry } from "@/lib/workout/store"
import {
  durationWheelValues,
  emptyBar,
  formatClock,
  formatDuration,
  formatLoad,
  fromKg,
  loadWheelValues,
  repWheelValues,
  snapToStep,
  loadStep,
  toKg,
  type Unit,
} from "@/lib/workout/units"

// ─────────────────────────────────────────────
// THE ACTIVE SESSION
//
// Picker → commit → rest → next set, without ever navigating. The screen has
// two states and one transition between them; everything else the module can
// do lives a layer down and is reachable only from the exercise name.
//
// Writes are optimistic. `logSet` is fired and the UI advances immediately —
// gym wifi is bad, and a spinner between a set and the rest clock would be the
// one stutter this screen cannot afford. Failures queue and retry rather than
// interrupting.
// ─────────────────────────────────────────────

const BWT = "BWT"

type Props = {
  sessionId: string
  startedAt: string
  dayName: string
  entries: PreparedEntry[]
  unit: Unit
  microPlates: boolean
  bodyweightKg: number | null
}

type Progress = Record<string, number>

export default function SessionScreen({
  sessionId,
  startedAt,
  dayName,
  entries,
  unit,
  microPlates,
  bodyweightKg,
}: Props) {
  const router = useRouter()
  const [entryIndex, setEntryIndex] = useState(0)
  const [completed, setCompleted] = useState<Progress>({})
  const [elapsed, setElapsed] = useState(0)
  const [resting, setResting] = useState(false)
  const [restRemaining, setRestRemaining] = useState(0)
  const [feedback, setFeedback] = useState<LoggedSet | null>(null)
  const [queued, setQueued] = useState(0)
  const [error, setError] = useState("")

  const entry = entries[entryIndex]
  const setsDone = entry ? (completed[entry.entryId] ?? 0) : 0
  const isTimed = entry?.exercise.modality === "duration"
  const isBodyweightMovement = entry?.exercise.modality === "bodyweight"

  // ── Wheel values ──
  const loadValues = useMemo(() => loadWheelValues(unit, microPlates), [unit, microPlates])
  const loadOptions = useMemo<WheelOption[]>(() => {
    const options = loadValues.map(value => ({ value: String(value), label: formatLoad(value) }))
    // BWT sits at the bottom of the weight range, below zero, because
    // bodyweight is not a smaller number than nothing — it is a different kind.
    return isBodyweightMovement ? [{ value: BWT, label: BWT }, ...options] : options
  }, [loadValues, isBodyweightMovement])
  const repOptions = useMemo<WheelOption[]>(
    () => repWheelValues().map(value => ({ value: String(value), label: String(value) })),
    [],
  )
  const durationOptions = useMemo<WheelOption[]>(
    () => durationWheelValues().map(value => ({ value: String(value), label: formatDuration(value) })),
    [],
  )

  const [loadValue, setLoadValue] = useState("0")
  const [repValue, setRepValue] = useState("5")
  const [durationValue, setDurationValue] = useState("45")

  // Seed the wheels from last session, falling back to the prescription. This
  // is the detail that makes the common case a confirm rather than an entry.
  const seedFor = useCallback((target: PreparedEntry) => {
    const step = loadStep(unit, microPlates)
    const kg = target.lastLoadKg ?? target.targetLoadKg
    const isBodyweightMove = target.exercise.modality === "bodyweight"
    // An unweighted bodyweight set stores 0 kg, so "no load" means BWT there and
    // an empty bar everywhere else — never a literal zero.
    const load = isBodyweightMove && !kg
      ? BWT
      : kg != null && kg > 0
        ? String(snapToStep(fromKg(kg, unit), step))
        : String(snapToStep(emptyBar(unit), step))
    return {
      load,
      reps: String(target.lastReps ?? target.targetReps ?? 5),
      duration: String(target.lastDurationSec ?? target.targetDurationSec ?? 45),
    }
  }, [unit, microPlates])

  useEffect(() => {
    if (!entry) return
    const seed = seedFor(entry)
    setLoadValue(seed.load)
    setRepValue(seed.reps)
    setDurationValue(seed.duration)
  }, [entry, seedFor])

  // ── Clocks ──
  useEffect(() => {
    const started = new Date(startedAt).getTime()
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const restEndsAt = useRef<number | null>(null)
  useEffect(() => {
    if (!resting) return
    // Drive the countdown from a timestamp, not a decrementing counter: iOS
    // throttles timers in a backgrounded tab and a counter would drift by
    // however long the phone was in a pocket.
    const tick = () => {
      const remaining = restEndsAt.current
        ? Math.max(0, Math.ceil((restEndsAt.current - Date.now()) / 1000))
        : 0
      setRestRemaining(remaining)
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [resting])

  if (!entry) {
    return (
      <div className="session">
        <div className="session-chrome">
          <span className="session-elapsed">{formatClock(elapsed)}</span>
          <button className="session-dismiss" onClick={() => void finish()}>Done</button>
        </div>
        <div className="rest">
          <div className="rest-countdown">{formatClock(elapsed)}</div>
          <div className="rest-label">SESSION COMPLETE</div>
        </div>
      </div>
    )
  }

  const totalSets = entry.targetSets
  const currentSet = Math.min(setsDone + 1, totalSets)
  const isBodyweightSet = loadValue === BWT
  const loadKg = isBodyweightSet ? 0 : toKg(Number(loadValue) || 0, unit)
  const reps = Number(repValue) || 1
  const durationSec = Number(durationValue) || 45

  const contextLine = isTimed
    ? `Set ${currentSet} of ${totalSets} — ${formatDuration(durationSec)}`
    : `Set ${currentSet} of ${totalSets} — ${reps} reps at ${isBodyweightSet ? BWT : `${formatLoad(Number(loadValue))} ${unit}`}`

  async function finish() {
    try {
      await endSession(sessionId)
    } catch {
      // Ending is a courtesy; a session with no end time is still complete
      // evidence. Never trap the user in the screen over it.
    }
    router.push("/train")
    router.refresh()
  }

  function commit() {
    const advancingToNext = setsDone + 1 >= totalSets
    const payload = {
      sessionId,
      exerciseId: entry.exercise.id,
      exerciseKey: entry.exercise.key,
      catalogKey: entry.exercise.catalogKey,
      setIndex: setsDone + 1,
      reps: isTimed ? 1 : reps,
      loadKg,
      durationSec: isTimed ? durationSec : null,
      isBodyweight: isBodyweightSet || isBodyweightMovement,
      bodyweightKg,
    }

    // Advance first, persist second. The screen is already showing the rest
    // clock by the time the request leaves the phone.
    setCompleted(current => ({ ...current, [entry.entryId]: setsDone + 1 }))
    setFeedback(null)
    setError("")
    restEndsAt.current = Date.now() + entry.restSec * 1000
    setRestRemaining(entry.restSec)
    setResting(true)
    if (advancingToNext && entryIndex + 1 < entries.length) {
      setEntryIndex(index => index + 1)
    }

    setQueued(count => count + 1)
    void logSet(payload)
      .then(result => setFeedback(result))
      .catch(() => setError("That set did not sync. It stays on screen — try again when you have signal."))
      .finally(() => setQueued(count => Math.max(0, count - 1)))
  }

  function adjustRest(delta: number) {
    const base = restEndsAt.current ?? Date.now()
    restEndsAt.current = Math.max(Date.now(), base + delta * 1000)
    setRestRemaining(Math.max(0, Math.ceil(((restEndsAt.current) - Date.now()) / 1000)))
  }

  function skipRest() {
    restEndsAt.current = null
    setResting(false)
    setRestRemaining(0)
  }

  return (
    <div className="session">
      {/* Region 1 — chrome */}
      <div className="session-chrome">
        <span className="session-elapsed">{formatClock(elapsed)}</span>
        <div className="session-chrome-meta">
          {queued > 0 && <span className="session-queued">syncing {queued}</span>}
          <button className="session-dismiss" onClick={() => void finish()}>End</button>
        </div>
      </div>

      {/* Region 2 — identity */}
      <div className="session-identity">
        <button
          className="session-exercise"
          onClick={() => router.push(`/exercise/${entry.exercise.key}`)}
        >
          {entry.exercise.label}
        </button>
        <div className="session-context">
          {contextLine}
          {entry.substitutedFor && (
            <span className="session-substituted">
              swapped for {entry.substitutedFor} — joint flare
            </span>
          )}
        </div>
      </div>

      {resting ? (
        /* Rest replaces the wheels in place; the user never navigates mid-set. */
        <div className="rest">
          <div className={restRemaining === 0 ? "rest-countdown expired" : "rest-countdown"}>
            {formatClock(restRemaining)}
          </div>
          <div className="rest-label">{restRemaining === 0 ? "READY" : "REST"}</div>

          {feedback && (
            <div className="rest-feedback">
              {feedback.rank != null && (
                <div className="rest-feedback-line">
                  <span>Rank</span>
                  <strong>{feedback.rank}{feedback.rankLetter ? ` · ${feedback.rankLetter}` : ""}</strong>
                </div>
              )}
              {feedback.balance != null && (
                <div className="rest-feedback-line">
                  <span>Balance</span>
                  <strong className="delta">
                    {feedback.balance >= 0 ? "+" : ""}{feedback.balance}
                  </strong>
                </div>
              )}
              {feedback.isPr && (
                <div className="rest-feedback-line">
                  <span>Personal record</span>
                  <strong className="delta">PR</strong>
                </div>
              )}
              {/* Never show a rank we can't defend — say why instead of
                  printing an em dash where a number should be. */}
              {feedback.rank === null && feedback.balance === null && (
                <div className="rest-suppressed mono mono-faint">
                  {feedback.suppressedRankReason ?? "Logged as evidence — not rated."}
                </div>
              )}
            </div>
          )}

          <div className="rest-actions">
            <button onClick={() => adjustRest(-30)}>−30s</button>
            <button onClick={() => adjustRest(30)}>+30s</button>
            <button onClick={skipRest}>{restRemaining === 0 ? "Next set" : "Skip"}</button>
          </div>
        </div>
      ) : (
        /* Region 3 — wheels */
        <div className="session-wheels">
          {isTimed ? (
            <WheelPicker
              label="Duration"
              options={durationOptions}
              value={durationValue}
              onChange={setDurationValue}
            />
          ) : (
            <>
              <WheelPicker
                label="Weight"
                unit={isBodyweightSet ? "" : unit}
                options={loadOptions}
                value={loadValue}
                onChange={setLoadValue}
              />
              <WheelPicker
                label="Reps"
                options={repOptions}
                value={repValue}
                onChange={setRepValue}
              />
            </>
          )}
        </div>
      )}

      {error && <div className="session-error">{error}</div>}

      {/* Region 4 — commit */}
      {!resting && (
        <button className="session-commit" onClick={commit}>
          Log set
          <small>
            {isTimed
              ? formatDuration(durationSec)
              : `${isBodyweightSet ? BWT : `${formatLoad(Number(loadValue))} ${unit}`} × ${reps}`}
          </small>
        </button>
      )}
      {resting && (
        <button className="session-commit" onClick={skipRest}>
          {restRemaining === 0 ? "Next set" : "Skip rest"}
          <small>{dayName}</small>
        </button>
      )}
    </div>
  )
}
