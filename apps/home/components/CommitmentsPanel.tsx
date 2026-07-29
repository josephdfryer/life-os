"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { STALE_DEFER_COUNT, type Commitment, type CommitmentAction, type UnclaimedItem } from "@/lib/commitments"

interface Props {
  today: Commitment[]
  parked: Commitment[]
  unclaimed: UnclaimedItem[]
  unclaimedTotal: number
  clearedThisWeek: number
  todayKey: string
  personsUrl: string
}

export default function CommitmentsPanel({
  today: initialToday,
  parked: initialParked,
  unclaimed: initialUnclaimed,
  unclaimedTotal,
  clearedThisWeek,
  todayKey,
  personsUrl,
}: Props) {
  const router = useRouter()
  const [today, setToday] = useState(initialToday)
  const [parked, setParked] = useState(initialParked)
  const [unclaimed, setUnclaimed] = useState(initialUnclaimed)
  const [remaining, setRemaining] = useState(unclaimedTotal)
  const [cleared, setCleared] = useState(clearedThisWeek)
  const [showParked, setShowParked] = useState(false)
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")

  // Rows update optimistically so a click feels instant, then `router.refresh()`
  // re-runs the server component. Without this the refreshed props would be
  // ignored and the next batch of unclaimed items would never appear.
  const serverState = [
    initialToday.map(item => item.id).join(","),
    initialParked.map(item => item.id).join(","),
    initialUnclaimed.map(item => item.id).join(","),
    unclaimedTotal,
    clearedThisWeek,
  ].join("|")
  const [lastServerState, setLastServerState] = useState(serverState)
  if (serverState !== lastServerState) {
    setLastServerState(serverState)
    setToday(initialToday)
    setParked(initialParked)
    setUnclaimed(initialUnclaimed)
    setRemaining(unclaimedTotal)
    setCleared(clearedThisWeek)
  }

  function drop(id: string) {
    setToday(items => items.filter(item => item.id !== id))
    setParked(items => items.filter(item => item.id !== id))
  }

  async function act(commitment: Commitment, action: CommitmentAction, scheduledStart?: string) {
    setBusyId(commitment.id)
    setError("")
    try {
      const response = await fetch(`/api/commitments/${commitment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, scheduledStart }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? "Could not update that commitment")
        return
      }
      if (action === "today") {
        // Pulling something in moves it between the two lists rather than
        // leaving the widget — it is now this morning's problem.
        const pulled = { ...commitment, dueOn: todayKey }
        setParked(items => items.filter(item => item.id !== commitment.id))
        setToday(items => [...items.filter(item => item.id !== commitment.id), pulled])
      } else {
        drop(commitment.id)
        if (action === "done") setCleared(count => count + 1)
      }
      setSchedulingId(null)
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function triage(item: UnclaimedItem, action: "commit" | "dismiss") {
    setBusyId(item.id)
    setError("")
    try {
      const response = await fetch("/api/commitments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId: item.interactionId, index: item.index, action }),
      })
      const body = await response.json().catch(() => null) as { error?: string; planId?: string } | null
      if (!response.ok) {
        setError(body?.error ?? "Could not triage that item")
        return
      }
      setUnclaimed(items => items.filter(entry => entry.id !== item.id))
      setRemaining(count => Math.max(0, count - 1))
      if (action === "commit" && body?.planId) {
        setToday(items => [...items, {
          id: body.planId as string,
          text: item.text,
          status: "active",
          dueOn: todayKey,
          deferCount: 0,
          createdAt: item.timestamp,
          personId: item.personId,
          personName: item.personName,
          ageDays: item.ageDays,
          stale: false,
        }])
      }
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  const nothingAtAll = today.length === 0 && parked.length === 0 && remaining === 0

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={heading}>Commitments</h2>
          <div style={eyebrow}>What you owe, and to whom</div>
        </div>
        <a href={`${personsUrl}/persons`} style={link}>Persons →</a>
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {nothingAtAll ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
          Nothing open right now
        </div>
      ) : (
        <>
          <section>
            <div style={sectionLabel}>
              <span>Today{today.length > 0 ? ` · ${today.length}` : ''}</span>
              {cleared > 0 && <span style={{ color: 'var(--camel)' }}>{cleared} cleared this week</span>}
            </div>

            {today.length === 0 ? (
              <div style={emptyLine}>
                {parked.length > 0
                  ? 'Nothing pulled in for today — pick one from parked below.'
                  : 'Nothing due today.'}
              </div>
            ) : (
              today.map(commitment => (
                <Row
                  key={commitment.id}
                  title={commitment.text}
                  meta={commitmentMeta(commitment, todayKey)}
                  personId={commitment.personId}
                  personName={commitment.personName}
                  personsUrl={personsUrl}
                  busy={busyId === commitment.id}
                  accent={commitment.dueOn !== null && commitment.dueOn < todayKey}
                >
                  {commitment.stale ? (
                    <>
                      <span style={staleNote}>Pushed {commitment.deferCount}× — decide</span>
                      {schedulingId === commitment.id ? (
                        <ScheduleInput
                          onCancel={() => setSchedulingId(null)}
                          onConfirm={value => void act(commitment, 'schedule', value)}
                        />
                      ) : (
                        <button style={button} onClick={() => setSchedulingId(commitment.id)}>Schedule</button>
                      )}
                      <button style={button} onClick={() => void act(commitment, 'drop')}>Drop</button>
                    </>
                  ) : (
                    <>
                      <button style={primaryButton} onClick={() => void act(commitment, 'done')}>Done</button>
                      <button style={button} onClick={() => void act(commitment, 'snooze')}>Snooze</button>
                      <button style={button} onClick={() => void act(commitment, 'drop')}>Drop</button>
                    </>
                  )}
                </Row>
              ))
            )}
          </section>

          {parked.length > 0 && (
            <section style={{ marginTop: '24px' }}>
              <button style={toggle} onClick={() => setShowParked(open => !open)}>
                {showParked ? '▾' : '▸'} Parked · {parked.length}
              </button>
              {showParked && parked.map(commitment => (
                <Row
                  key={commitment.id}
                  title={commitment.text}
                  meta={commitmentMeta(commitment, todayKey)}
                  personId={commitment.personId}
                  personName={commitment.personName}
                  personsUrl={personsUrl}
                  busy={busyId === commitment.id}
                >
                  <button style={primaryButton} onClick={() => void act(commitment, 'today')}>Today</button>
                  <button style={button} onClick={() => void act(commitment, 'done')}>Done</button>
                  <button style={button} onClick={() => void act(commitment, 'drop')}>Drop</button>
                </Row>
              ))}
            </section>
          )}

          {remaining > 0 && (
            <section style={{ marginTop: '24px' }}>
              <div style={sectionLabel}>
                <span>Unclaimed · {remaining}</span>
                <span style={{ color: 'var(--ink-3)' }}>pulled from conversations</span>
              </div>
              {unclaimed.map(item => (
                <Row
                  key={item.id}
                  title={item.text}
                  meta={unclaimedMeta(item)}
                  personId={item.personId}
                  personName={item.personName}
                  personsUrl={personsUrl}
                  busy={busyId === item.id}
                >
                  <button style={primaryButton} onClick={() => void triage(item, 'commit')}>Commit</button>
                  <button style={button} onClick={() => void triage(item, 'dismiss')}>Not mine</button>
                </Row>
              ))}
              {remaining > unclaimed.length && (
                <div style={emptyLine}>
                  {remaining - unclaimed.length} more behind these. Clear this batch to see the next.
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Row({
  title,
  meta,
  personId,
  personName,
  personsUrl,
  busy,
  accent,
  children,
}: {
  title: string
  meta: string
  personId: string | null
  personName: string | null
  personsUrl: string
  busy: boolean
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ ...row, opacity: busy ? 0.45 : 1, borderLeftColor: accent ? 'var(--camel)' : 'rgba(196, 165, 116, 0.34)' }}>
      <div style={{ fontSize: '14px', lineHeight: 1.4 }}>{title}</div>
      <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '4px' }}>
        {personName && personId ? (
          <a href={`${personsUrl}/persons/${personId}`} style={link}>{personName}</a>
        ) : personName ?? '—'}
        {meta && ` · ${meta}`}
      </div>
      <div style={actions}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {children}
        </fieldset>
      </div>
    </div>
  )
}

function ScheduleInput({
  onConfirm,
  onCancel,
}: {
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState("")
  return (
    <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
      <input
        type="datetime-local"
        value={value}
        onChange={event => setValue(event.target.value)}
        style={dateInput}
      />
      <button style={primaryButton} disabled={!value} onClick={() => onConfirm(new Date(value).toISOString())}>
        Set
      </button>
      <button style={button} onClick={onCancel}>Cancel</button>
    </span>
  )
}

function commitmentMeta(commitment: Commitment, todayKey: string) {
  const parts: string[] = []
  if (commitment.dueOn && commitment.dueOn < todayKey) parts.push('overdue')
  if (commitment.ageDays > 0) parts.push(`${commitment.ageDays}d old`)
  if (commitment.status === 'blocked') parts.push('blocked')
  if (commitment.deferCount > 0 && !commitment.stale) {
    parts.push(`pushed ${commitment.deferCount}× of ${STALE_DEFER_COUNT}`)
  }
  return parts.join(' · ')
}

function unclaimedMeta(item: UnclaimedItem) {
  const parts: string[] = []
  if (item.eventName) parts.push(item.eventName)
  if (item.ageDays > 0) parts.push(`said ${item.ageDays}d ago`)
  return parts.join(' · ')
}

const card: React.CSSProperties = {
  background: 'rgba(247, 244, 238, 0.045)',
  border: '1px solid rgba(196, 165, 116, 0.18)',
  borderRadius: 'var(--radius-lg)',
  padding: '32px',
}

const heading: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '1.4rem',
  fontWeight: 400,
  margin: 0,
}

const eyebrow: React.CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '11px',
  marginTop: '3px',
}

const link: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--camel)',
  textDecoration: 'none',
}

const sectionLabel: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '11px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: '10px',
}

const row: React.CSSProperties = {
  borderLeft: '2px solid rgba(196, 165, 116, 0.34)',
  paddingLeft: '12px',
  paddingTop: '8px',
  paddingBottom: '10px',
  transition: 'opacity 120ms ease',
}

const actions: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginTop: '8px',
  flexWrap: 'wrap',
}

const button: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(196, 165, 116, 0.3)',
  borderRadius: '4px',
  color: 'var(--ink-3)',
  cursor: 'pointer',
  fontSize: '11px',
  padding: '4px 10px',
}

const primaryButton: React.CSSProperties = {
  ...button,
  borderColor: 'var(--camel)',
  color: 'var(--camel)',
}

const toggle: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  color: 'var(--ink-3)',
  cursor: 'pointer',
  fontSize: '11px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: 0,
  marginBottom: '10px',
}

const emptyLine: React.CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '13px',
  padding: '8px 0',
}

const staleNote: React.CSSProperties = {
  color: 'var(--camel)',
  fontSize: '11px',
}

const dateInput: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(196, 165, 116, 0.3)',
  borderRadius: '4px',
  color: 'inherit',
  fontSize: '11px',
  padding: '3px 6px',
}

const errorBox: React.CSSProperties = {
  border: '1px solid rgba(196, 165, 116, 0.4)',
  borderRadius: '4px',
  color: 'var(--camel)',
  fontSize: '12px',
  marginBottom: '16px',
  padding: '8px 12px',
}
