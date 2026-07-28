"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTimeZone } from "@life-os/ui"
import Link from "next/link"

type NoteRow = {
  id: string
  timestamp: string
  createdAt: string
  type: string
  content: string
  truncated: boolean
  sourceFileId: string | null
  derivedCount: number
}

type NoteDetail = NoteRow & {
  metadata: unknown
  sourceFile: { id: string; filename: string; format: string } | null
  plans: { id: string; text: string; status: string }[]
  events: { id: string; name: string; start: string }[]
  interactions: { id: string; type: string; timestamp: string; summary: string | null; person: { id: string; first: string; last: string } | null }[]
  states: { id: string; entityType: string; entityId: string; recordedAt: string; definition: { type: string; value: string } }[]
  groups: { id: string; name: string }[]
}

const CAPTURE_TYPES = [
  { value: "thought", label: "Thought" },
  { value: "observation", label: "Observation" },
  { value: "declaration", label: "Declaration" },
]

export default function NotesPage() {
  const tz = useTimeZone()
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const loadingMore = useRef(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Composer
  const [draft, setDraft] = useState("")
  const [draftType, setDraftType] = useState("thought")
  const [saving, setSaving] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "50" })
    if (typeFilter) params.set("type", typeFilter)
    if (search.trim()) params.set("q", search.trim())
    return params.toString()
  }, [typeFilter, search])

  useEffect(() => {
    const timer = setTimeout(load, search.trim() ? 250 : 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/notes?${query}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not load notes")
      setNotes(data.notes ?? [])
      setTotal(data.total ?? null)
      setNextCursor(data.nextCursor ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notes")
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore.current) return
    loadingMore.current = true
    try {
      const res = await fetch(`/api/notes?${query}&cursor=${encodeURIComponent(nextCursor)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not load more")
      setNotes(prev => {
        const seen = new Set(prev.map(n => n.id))
        return [...prev, ...(data.notes ?? []).filter((n: NoteRow) => !seen.has(n.id))]
      })
      setNextCursor(data.nextCursor ?? null)
    } catch {
      // next scroll retries
    } finally {
      loadingMore.current = false
    }
  }

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !nextCursor) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore()
    }, { rootMargin: "600px" })
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor])

  async function capture() {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, type: draftType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not save note")
      setDraft("")
      setNotes(prev => [{ ...data, truncated: false, derivedCount: 0 }, ...prev])
      setTotal(t => (t === null ? t : t + 1))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save note")
    } finally {
      setSaving(false)
    }
  }

  function removeNote(id: string) {
    setNotes(prev => prev.filter(n => n.id !== id))
    setTotal(t => (t === null ? t : Math.max(0, t - 1)))
    setExpandedId(prev => (prev === id ? null : prev))
    fetch(`/api/notes/${id}`, { method: "DELETE" }).catch(() => load())
  }

  // Group by day for the stream
  const groups = useMemo(() => {
    const byDay = new Map<string, NoteRow[]>()
    for (const note of notes) {
      const day = new Date(note.timestamp).toDateString()
      byDay.set(day, [...(byDay.get(day) ?? []), note])
    }
    return [...byDay.entries()]
  }, [notes])

  return (
    <div style={{ width: "min(100%, 760px)", margin: "0 auto", padding: "36px 24px 80px" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", fontWeight: 400, color: "var(--ink)", letterSpacing: "-0.02em", margin: "0 0 6px" }}>
        Notes
      </h1>
      <p style={{ fontSize: "12px", color: "var(--ink-3)", margin: "0 0 24px", maxWidth: "560px", lineHeight: 1.6 }}>
        The entry point for unstructured thought. Raw captures live here before they resolve into
        structure — every plan, event, or state derived from a note traces back to it.
      </p>

      {/* Composer */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "14px 16px", marginBottom: "28px" }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") capture() }}
          placeholder="Capture a thought…"
          rows={3}
          style={{
            width: "100%", boxSizing: "border-box", border: "none", outline: "none",
            background: "transparent", color: "var(--ink)", font: "inherit",
            fontSize: "14px", lineHeight: 1.6, resize: "vertical",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
          {CAPTURE_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setDraftType(t.value)}
              style={{
                padding: "3px 12px", borderRadius: "999px", fontSize: "11px", cursor: "pointer",
                border: `1px solid ${draftType === t.value ? "var(--ink-3)" : "var(--border)"}`,
                background: draftType === t.value ? "var(--ink)" : "transparent",
                color: draftType === t.value ? "var(--surface)" : "var(--ink-3)",
                font: "inherit",
              }}
            >
              {t.label}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--ink-4)" }}>⌘⏎</span>
          <button
            onClick={capture}
            disabled={!draft.trim() || saving}
            style={{
              padding: "6px 18px", borderRadius: "999px", fontSize: "12px", fontWeight: 500,
              border: "none", cursor: draft.trim() && !saving ? "pointer" : "default",
              background: draft.trim() ? "var(--ink)" : "var(--border)",
              color: draft.trim() ? "var(--surface)" : "var(--ink-4)",
              font: "inherit",
            }}
          >
            {saving ? "Saving…" : "Capture"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search notes…"
          style={{
            flex: "1 1 200px", padding: "7px 12px", fontSize: "12px",
            border: "1px solid var(--border)", borderRadius: "999px",
            background: "var(--surface)", color: "var(--ink)", font: "inherit", outline: "none",
          }}
        />
        <FilterPill label="All" active={typeFilter === null} onClick={() => setTypeFilter(null)} />
        <FilterPill label="Thoughts" active={typeFilter === "thought"} onClick={() => setTypeFilter("thought")} />
        <FilterPill label="Observations" active={typeFilter === "observation"} onClick={() => setTypeFilter("observation")} />
        <FilterPill label="Declarations" active={typeFilter === "declaration"} onClick={() => setTypeFilter("declaration")} />
        <FilterPill label="Voice" active={typeFilter === "voice_transcript"} onClick={() => setTypeFilter("voice_transcript")} />
        <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>{total ?? "…"} notes</span>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", fontSize: "12px", border: "1px solid #d28a5d", background: "#fff4eb", color: "#914a22", borderRadius: "8px", marginBottom: "16px" }}>
          {error}
        </div>
      )}

      {loading && <p style={{ fontSize: "12px", color: "var(--ink-3)" }}>Loading…</p>}

      {!loading && notes.length === 0 && (
        <div style={{ padding: "48px 24px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: "12px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "16px", color: "var(--ink-2)", marginBottom: "4px" }}>Nothing captured yet</div>
          <div style={{ fontSize: "12px", color: "var(--ink-4)" }}>Write the first thing on your mind above.</div>
        </div>
      )}

      {groups.map(([day, dayNotes]) => (
        <div key={day} style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "10px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-4)", margin: "0 0 8px" }}>
            {formatDay(day, tz)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {dayNotes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                expanded={expandedId === note.id}
                onToggle={() => setExpandedId(id => (id === note.id ? null : note.id))}
                onDelete={() => removeNote(note.id)}
              />
            ))}
          </div>
        </div>
      ))}

      {nextCursor && (
        <div ref={sentinelRef} style={{ padding: "14px", textAlign: "center", fontSize: "11px", color: "var(--ink-4)" }}>
          Loading more…
        </div>
      )}
    </div>
  )
}

function NoteCard({ note, expanded, onToggle, onDelete }: {
  note: NoteRow
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const tz = useTimeZone()
  const [detail, setDetail] = useState<NoteDetail | null>(null)

  useEffect(() => {
    if (!expanded || detail) return
    let cancelled = false
    fetch(`/api/notes/${note.id}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data) setDetail(data) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  const time = new Date(note.timestamp).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
      <div onClick={onToggle} style={{ padding: "12px 16px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "6px" }}>
          <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{time}</span>
          {note.type !== "thought" && (
            <span style={{ fontSize: "10px", padding: "0 7px", borderRadius: "999px", border: "1px solid var(--border)", color: "var(--ink-4)" }}>
              {note.type.replace("_", " ")}
            </span>
          )}
          {note.derivedCount > 0 && (
            <span style={{ fontSize: "10px", padding: "0 7px", borderRadius: "999px", border: "1px solid #88a06a", color: "#526b37", background: "#f3f7ee" }}>
              {note.derivedCount} derived
            </span>
          )}
        </div>
        <div style={{ fontSize: "13px", color: "var(--ink)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {expanded && detail ? detail.content : note.content}
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "10px 16px 12px", background: "var(--bg)" }}>
          {!detail && <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>Loading…</div>}
          {detail && (
            <>
              {(detail.plans.length + detail.events.length + detail.interactions.length + detail.states.length + detail.groups.length) > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                  {detail.plans.map(p => <ProvenanceChip key={p.id} kind="Plan" label={p.text} />)}
                  {detail.events.map(e => <ProvenanceChip key={e.id} kind="Event" label={e.name} />)}
                  {detail.interactions.map(ix => (
                    <ProvenanceChip key={ix.id} kind="Interaction" label={ix.person ? `${ix.person.first} ${ix.person.last}` : ix.summary ?? ix.type} />
                  ))}
                  {detail.states.map(s => <ProvenanceChip key={s.id} kind="State" label={`${s.definition.type}: ${s.definition.value}`} />)}
                  {detail.groups.map(g => <ProvenanceChip key={g.id} kind="Group" label={g.name} />)}
                </div>
              ) : (
                <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "10px" }}>
                  Nothing derived from this note yet — synthesis will pick it up.
                </div>
              )}
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                {detail.metadata != null && typeof detail.metadata === "object" && "subjectPersonId" in (detail.metadata as Record<string, unknown>) && (
                  <Link
                    href={`/person/${(detail.metadata as Record<string, string>).subjectPersonId}`}
                    style={{ fontSize: "11px", color: "var(--ink-3)" }}
                  >
                    View theory →
                  </Link>
                )}
                <button
                  onClick={e => { e.stopPropagation(); if (confirm("Delete this note?")) onDelete() }}
                  style={{ marginLeft: "auto", fontSize: "11px", color: "var(--ink-4)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ProvenanceChip({ kind, label }: { kind: string; label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      fontSize: "10px", padding: "2px 9px", borderRadius: "999px",
      border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink-3)",
      maxWidth: "260px", overflow: "hidden",
    }}>
      <span style={{ color: "var(--ink-4)", fontWeight: 500 }}>{kind}</span>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </span>
  )
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 12px", borderRadius: "999px", fontSize: "11px", cursor: "pointer",
        border: `1px solid ${active ? "var(--ink-3)" : "var(--border)"}`,
        background: active ? "var(--ink)" : "transparent",
        color: active ? "var(--surface)" : "var(--ink-3)",
        font: "inherit",
      }}
    >
      {label}
    </button>
  )
}

function formatDay(day: string, timeZone?: string) {
  const date = new Date(day)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return "Today"
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" })
}
