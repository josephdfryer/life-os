"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  MAX_FOCUS,
  STALE_DEFER_COUNT,
  suggestionReason,
  type Commitment,
  type CommitmentAction,
  type UnclaimedItem,
} from "@/lib/commitments"

interface Props {
  focused: Commitment[]
  suggestion: Commitment | null
  backlog: Commitment[]
  actionInbox: Commitment[]
  actionInboxTotal: number
  unclaimed: UnclaimedItem[]
  unclaimedTotal: number
  clearedThisWeek: number
  todayKey: string
  personsUrl: string
}

export default function CommitmentsPanel({
  focused: initialFocused,
  suggestion: initialSuggestion,
  backlog: initialBacklog,
  actionInbox: initialActionInbox,
  actionInboxTotal,
  unclaimed: initialUnclaimed,
  unclaimedTotal,
  clearedThisWeek,
  todayKey,
  personsUrl,
}: Props) {
  const router = useRouter()
  const [focused, setFocused] = useState(initialFocused)
  const [suggestion, setSuggestion] = useState(initialSuggestion)
  const [backlog, setBacklog] = useState(initialBacklog)
  const [actionInbox, setActionInbox] = useState(initialActionInbox)
  const [actionInboxRemaining, setActionInboxRemaining] = useState(actionInboxTotal)
  const [unclaimed, setUnclaimed] = useState(initialUnclaimed)
  const [remaining, setRemaining] = useState(unclaimedTotal)
  const [cleared, setCleared] = useState(clearedThisWeek)
  const [showBacklog, setShowBacklog] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")

  // Rows update optimistically so a click feels instant, then `router.refresh()`
  // re-runs the server component. Without this the refreshed props would be
  // ignored and the next batch would never appear.
  const serverState = [
    initialFocused.map(item => item.id).join(","),
    initialSuggestion?.id ?? "",
    initialBacklog.map(item => item.id).join(","),
    initialActionInbox.map(item => item.id).join(","),
    actionInboxTotal,
    initialUnclaimed.map(item => item.id).join(","),
    unclaimedTotal,
    clearedThisWeek,
  ].join("|")
  const [lastServerState, setLastServerState] = useState(serverState)
  if (serverState !== lastServerState) {
    setLastServerState(serverState)
    setFocused(initialFocused)
    setSuggestion(initialSuggestion)
    setBacklog(initialBacklog)
    setActionInbox(initialActionInbox)
    setActionInboxRemaining(actionInboxTotal)
    setUnclaimed(initialUnclaimed)
    setRemaining(unclaimedTotal)
    setCleared(clearedThisWeek)
  }

  function drop(id: string) {
    setFocused(items => items.filter(item => item.id !== id))
    setBacklog(items => items.filter(item => item.id !== id))
    setActionInbox(items => items.filter(item => item.id !== id))
    setSuggestion(current => (current?.id === id ? null : current))
  }

  const openSlots = MAX_FOCUS - focused.length

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
      if (commitment.status === "draft") {
        setActionInboxRemaining(count => Math.max(0, count - 1))
      }
      if (action === "focus") {
        // Pulling something in is always a deliberate, individual choice —
        // it moves into Focus and out of wherever it was, nothing else moves.
        const pulled = { ...commitment, status: "active", focusedAt: new Date().toISOString() }
        setBacklog(items => items.filter(item => item.id !== commitment.id))
        setActionInbox(items => items.filter(item => item.id !== commitment.id))
        setFocused(items => [...items.filter(item => item.id !== commitment.id), pulled])
        setSuggestion(current => (current?.id === commitment.id ? null : current))
        setShowPicker(false)
      } else if (action === "unfocus") {
        // Swap-out: back to the backlog, not dropped — the commitment is
        // still real, it's just not what Joseph is doing right now.
        const parked = { ...commitment, focusedAt: null }
        setFocused(items => items.filter(item => item.id !== commitment.id))
        setBacklog(items => [...items.filter(item => item.id !== commitment.id), parked])
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

  async function triage(item: UnclaimedItem, action: "commit" | "done" | "dismiss") {
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
      if (action === "done") setCleared(count => count + 1)
      if (action === "commit" && body?.planId) {
        // A committed action item lands in the backlog, not straight into
        // Focus — capture stays free, committing to work it *now* is still a
        // separate, deliberate pull.
        setBacklog(items => [...items, {
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
          focusedAt: null,
        }])
      }
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  const nothingAtAll = focused.length === 0 && backlog.length === 0 && actionInboxRemaining === 0 && remaining === 0
  const pickable = [...actionInbox, ...backlog].filter(item => item.id !== suggestion?.id)

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={heading}>Focus</h2>
          <div style={eyebrow}>The {MAX_FOCUS} things you're actually working on</div>
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
              <span>Focus · {focused.length}/{MAX_FOCUS}</span>
              {cleared > 0 && <span style={{ color: 'var(--camel)' }}>{cleared} cleared this week</span>}
            </div>

            {focused.length === 0 && (
              <div style={emptyLine}>Nothing in focus — pull in one thing below.</div>
            )}

            {focused.map(commitment => (
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
                    <button style={button} onClick={() => void act(commitment, 'unfocus')}>Swap out</button>
                    <button style={button} onClick={() => void act(commitment, 'drop')}>Drop</button>
                  </>
                )}
              </Row>
            ))}

            {openSlots > 0 && (suggestion || pickable.length > 0) && (
              <div style={suggestionBox}>
                {suggestion ? (
                  <>
                    <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginBottom: '6px' }}>
                      Open slot · suggested next
                    </div>
                    <Row
                      title={suggestion.text}
                      meta={suggestionReason(suggestion)}
                      personId={suggestion.personId}
                      personName={suggestion.personName}
                      personsUrl={personsUrl}
                      busy={busyId === suggestion.id}
                    >
                      <button style={primaryButton} onClick={() => void act(suggestion, 'focus')}>Add to Focus</button>
                      <button style={button} onClick={() => setShowPicker(open => !open)}>
                        {showPicker ? 'Hide options' : 'See other options'}
                      </button>
                    </Row>
                  </>
                ) : (
                  <button style={button} onClick={() => setShowPicker(open => !open)}>
                    {showPicker ? 'Hide options' : 'Pick something for the open slot'}
                  </button>
                )}

                {showPicker && (
                  <div style={{ marginTop: '10px' }}>
                    {pickable.length === 0 ? (
                      <div style={emptyLine}>Nothing else open right now.</div>
                    ) : (
                      pickable.slice(0, 5).map(candidate => (
                        <Row
                          key={candidate.id}
                          title={candidate.text}
                          meta={suggestionReason(candidate)}
                          personId={candidate.personId}
                          personName={candidate.personName}
                          personsUrl={personsUrl}
                          busy={busyId === candidate.id}
                        >
                          <button style={primaryButton} onClick={() => void act(candidate, 'focus')}>Add to Focus</button>
                        </Row>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {actionInboxRemaining > 0 && (
            <section style={{ marginTop: '24px' }}>
              <div style={sectionLabel}>
                <span>Action inbox · {actionInboxRemaining}</span>
                <span style={{ color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 }}>Remembered, not promised</span>
              </div>
              {actionInbox.map(action => (
                <Row
                  key={action.id}
                  title={action.text}
                  meta={action.ageDays > 0 ? `captured ${action.ageDays}d ago` : 'captured today'}
                  personId={action.personId}
                  personName={action.personName}
                  personsUrl={personsUrl}
                  busy={busyId === action.id}
                >
                  <button
                    style={primaryButton}
                    disabled={openSlots <= 0}
                    onClick={() => void act(action, 'focus')}
                  >
                    Add to Focus
                  </button>
                  {schedulingId === action.id ? (
                    <ScheduleInput
                      onCancel={() => setSchedulingId(null)}
                      onConfirm={value => void act(action, 'schedule', value)}
                    />
                  ) : (
                    <button style={button} onClick={() => setSchedulingId(action.id)}>Schedule</button>
                  )}
                  <button style={button} onClick={() => void act(action, 'drop')}>Drop</button>
                </Row>
              ))}
              {actionInboxRemaining > actionInbox.length && (
                <div style={emptyLine}>
                  {actionInboxRemaining - actionInbox.length} more safely held. Clear this batch to see the next.
                </div>
              )}
            </section>
          )}

          {backlog.length > 0 && (
            <section style={{ marginTop: '24px' }}>
              <button style={toggle} onClick={() => setShowBacklog(open => !open)}>
                {showBacklog ? '▾' : '▸'} Backlog · {backlog.length}
              </button>
              {showBacklog && backlog.map(commitment => (
                <Row
                  key={commitment.id}
                  title={commitment.text}
                  meta={commitmentMeta(commitment, todayKey)}
                  personId={commitment.personId}
                  personName={commitment.personName}
                  personsUrl={personsUrl}
                  busy={busyId === commitment.id}
                >
                  <button
                    style={primaryButton}
                    disabled={openSlots <= 0}
                    onClick={() => void act(commitment, 'focus')}
                  >
                    Add to Focus
                  </button>
                  <button style={button} onClick={() => void act(commitment, 'done')}>Done</button>
                  <button style={button} onClick={() => void act(commitment, 'drop')}>Drop</button>
                </Row>
              ))}
            </section>
          )}

          {remaining > 0 && (
            <section style={{ marginTop: '24px' }}>
              <div style={sectionLabel}>
                <span>From conversations · {remaining}</span>
                <span style={{ color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 }}>Needs a decision</span>
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
                  <button style={button} onClick={() => void triage(item, 'done')}>Done</button>
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

const suggestionBox: React.CSSProperties = {
  border: '1px dashed rgba(196, 165, 116, 0.4)',
  borderRadius: 'var(--radius)',
  marginTop: '8px',
  padding: '12px',
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
  borderRadius: 'var(--radius-pill)',
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
  borderRadius: 'var(--radius)',
  color: 'inherit',
  fontSize: '11px',
  padding: '3px 6px',
}

const errorBox: React.CSSProperties = {
  border: '1px solid rgba(196, 165, 116, 0.4)',
  borderRadius: 'var(--radius)',
  color: 'var(--camel)',
  fontSize: '12px',
  marginBottom: '16px',
  padding: '8px 12px',
}
