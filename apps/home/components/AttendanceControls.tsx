"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type OwnerAttendance = "going" | "not_going"
type OwnerAttendanceAction = "going" | "not_going" | "did_go" | "did_not_go" | "not_event"
type AttendanceTension = "aligned" | "missed" | "showed_up" | "pending"

type Props = {
  planId: string | null
  // Set once the row has been promoted to an Event. Attendance is answered
  // against the Plan, but "this was never an occasion" has to be answered
  // against the Event, because by then the Plan may be gone.
  eventId?: string | null
  phase: "future" | "past"
  declared: OwnerAttendance
  reconciliationStatus: string | null
  tension: AttendanceTension
  endpointFor: (planId: string) => string
  notEventEndpointFor?: (eventId: string) => string
  variant?: "light" | "dark"
}

export default function AttendanceControls({
  planId,
  eventId = null,
  phase,
  declared,
  reconciliationStatus,
  tension,
  endpointFor,
  notEventEndpointFor,
  variant = "dark",
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closed = reconciliationStatus === "happened" || reconciliationStatus === "skip" || reconciliationStatus === "cancelled"
  // A materialised Event with no surviving Plan can still be declassified, so
  // the row is not inert just because attendance is unanswerable.
  const canDeclassify = Boolean(eventId && notEventEndpointFor)

  if (!planId && !canDeclassify) return null

  async function act(action: OwnerAttendanceAction) {
    // "not event" is a classification, not an attendance answer, and once the
    // row is an Event it is addressed by eventId — the Plan may not exist.
    const declassifyingEvent = action === "not_event" && canDeclassify
    const url = declassifyingEvent
      ? notEventEndpointFor!(eventId!)
      : planId
        ? endpointFor(planId)
        : null
    if (!url) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(declassifyingEvent ? {} : { action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error?.message ?? data.error ?? "Could not update attendance")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update attendance")
    } finally {
      setBusy(false)
    }
  }

  const dark = variant === "dark"
  const label = reconciliationStatus === "happened" ? "Went" : "Didn't go"

  return (
    <div onClick={(event) => event.preventDefault()} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
      {closed ? (
        // A settled row still gets the classification escape hatch: "Went" is
        // the wrong answer for something that was never an occasion, and this
        // is the only place that judgement can now be made.
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <span style={pill(dark, false, true)}>{label}</span>
          {canDeclassify && (
            <button type="button" disabled={busy} onClick={() => void act("not_event")} style={pill(dark, false, false)}>
              Not event
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: "6px" }}>
          {phase === "past" ? (
            <>
              <button type="button" disabled={busy} onClick={() => void act("did_go")} style={pill(dark, false, false)}>
                Did go
              </button>
              <button type="button" disabled={busy} onClick={() => void act("did_not_go")} style={pill(dark, false, false)}>
                Didn&apos;t
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => void act("going")} style={pill(dark, declared === "going", false)}>
                Going
              </button>
              <button type="button" disabled={busy} onClick={() => void act("not_going")} style={pill(dark, declared === "not_going", false)}>
                Not going
              </button>
            </>
          )}
          {/* Available in both phases: whether a row is an occasion at all is
              independent of whether it has happened yet. */}
          <button type="button" disabled={busy} onClick={() => void act("not_event")} style={pill(dark, false, false)}>
            Not event
          </button>
        </div>
      )}
      {tension === "missed" && <span style={meta(dark)}>Said going</span>}
      {tension === "showed_up" && <span style={meta(dark)}>Showed up</span>}
      {error && <span style={{ fontSize: "10px", color: "var(--attention, #c45c26)" }}>{error}</span>}
    </div>
  )
}

function pill(dark: boolean, active: boolean, staticLabel: boolean): React.CSSProperties {
  return {
    fontFamily: "inherit",
    fontSize: "10px",
    padding: "3px 9px",
    borderRadius: "999px",
    cursor: staticLabel ? "default" : "pointer",
    border: active
      ? "1px solid var(--cognac, #8f6b4a)"
      : dark
        ? "1px solid rgba(196, 165, 116, 0.24)"
        : "1px solid var(--border, #d9d0c3)",
    background: active
      ? dark ? "rgba(196, 165, 116, 0.18)" : "var(--cognac-soft, #efe4d4)"
      : "transparent",
    color: active
      ? dark ? "var(--camel, #c4a574)" : "var(--cognac-deep, #6e5238)"
      : dark ? "var(--ink-3, #a69c90)" : "var(--ink-3, #7a7268)",
  }
}

function meta(dark: boolean): React.CSSProperties {
  return {
    fontSize: "10px",
    color: dark ? "var(--camel, #c4a574)" : "var(--cognac, #8f6b4a)",
  }
}
