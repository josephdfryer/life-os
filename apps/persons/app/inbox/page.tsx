"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"

type PersonRef = {
  id: string
  first: string
  last: string
  title: string | null
  company: string | null
  emails: string[]
  phones: string[]
}

// Lean list row — the list endpoint omits bodies and rule runs entirely.
type InboxItem = {
  id: string
  source: string
  sourceId: string
  status: string
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  candidatePersonId: string | null
  candidatePerson: PersonRef | null
  type: string
  timestamp: string
  summary: string | null
  direction: string | null
  createdAt: string
  hasSuggestions: boolean
}

// Full detail, fetched lazily when a row expands.
type InboxDetail = InboxItem & {
  body: string | null
  ruleRuns: RuleRun[]
}

type RuleRun = {
  id: string
  createdAt: string
  trigger: string
  matched: boolean
  mode: string
  status: string
  message: string | null
  actionsPlanned: unknown
  actionsApplied: unknown
  rule: { id: string; name: string; trigger: string }
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Count of in-flight background syncs — shown as an indicator, never blocks.
  const [syncing, setSyncing] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bulkPersonSearch, setBulkPersonSearch] = useState("")
  const [bulkPersonResults, setBulkPersonResults] = useState<PersonRef[]>([])
  const [bulkPerson, setBulkPerson] = useState<PersonRef | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const loadingMore = useRef(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const lastCheckedIndex = useRef<number | null>(null)

  const sources = useMemo(() => {
    const seen = new Set<string>()
    for (const item of items) seen.add(item.source)
    return [...seen].sort()
  }, [items])

  const rows = useMemo(
    () => sourceFilter ? items.filter(item => item.source === sourceFilter) : items,
    [items, sourceFilter],
  )

  const selectedInView = useMemo(
    () => rows.filter(row => selectedIds.has(row.id)),
    [rows, selectedIds],
  )
  const matchedInSelection = selectedInView.filter(row => row.candidatePersonId).length

  useEffect(() => {
    if (selectedIds.size === 0 || !bulkPersonSearch.trim()) {
      setBulkPersonResults([])
      if (selectedIds.size === 0) {
        setBulkPersonSearch("")
        setBulkPerson(null)
      }
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/persons?minimal=true&search=${encodeURIComponent(bulkPersonSearch)}&limit=8`, {
          signal: controller.signal,
        })
        const data = res.ok ? await res.json() : {}
        setBulkPersonResults(data.persons ?? [])
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setBulkPersonResults([])
      }
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [bulkPersonSearch, selectedIds.size])

  useEffect(() => { loadItems() }, [])

  // Keyboard: j/k move · x select · e dismiss · Enter open/close · Esc close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return
      if (rows.length === 0) return
      const focused = rows[Math.min(focusedIndex, rows.length - 1)]
      if (e.key === "j") {
        setFocusedIndex(i => Math.min(i + 1, rows.length - 1))
      } else if (e.key === "k") {
        setFocusedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === "x" && focused) {
        toggleSelect(focused.id)
      } else if (e.key === "e") {
        if (selectedIds.size > 0) bulkAction("dismiss")
        else if (focused) dismissOne(focused.id)
      } else if (e.key === "Enter" && focused) {
        setExpandedId(id => id === focused.id ? null : focused.id)
      } else if (e.key === "Escape") {
        setExpandedId(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [rows, focusedIndex, selectedIds])

  async function loadItems() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/inbox?status=review&limit=50")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not load inbox")
      let loaded = (data.items ?? []) as InboxItem[]
      const requestedItemId = new URLSearchParams(window.location.search).get("item")
      if (requestedItemId && !loaded.some(item => item.id === requestedItemId)) {
        const detailRes = await fetch(`/api/inbox/${encodeURIComponent(requestedItemId)}`)
        if (detailRes.ok) loaded = [await detailRes.json() as InboxItem, ...loaded]
      }
      setItems(loaded)
      setTotal(data.total ?? null)
      setNextCursor(data.nextCursor ?? null)
      setSelectedIds(new Set())
      const requestedIndex = requestedItemId ? loaded.findIndex(item => item.id === requestedItemId) : -1
      setFocusedIndex(requestedIndex >= 0 ? requestedIndex : 0)
      if (requestedIndex >= 0) setExpandedId(requestedItemId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load inbox")
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore.current) return
    loadingMore.current = true
    try {
      const res = await fetch(`/api/inbox?status=review&limit=50&cursor=${encodeURIComponent(nextCursor)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not load more")
      setItems(prev => {
        const seen = new Set(prev.map(item => item.id))
        return [...prev, ...(data.items ?? []).filter((item: InboxItem) => !seen.has(item.id))]
      })
      setNextCursor(data.nextCursor ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more")
    } finally {
      loadingMore.current = false
    }
  }

  // Infinite scroll: fetch the next page well before the user reaches the end.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !nextCursor) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore()
    }, { rootMargin: "800px" })
    observer.observe(el)
    return () => observer.disconnect()
  }, [nextCursor])

  function toggleSelect(id: string, shiftKey = false) {
    const index = rows.findIndex(row => row.id === id)
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (shiftKey && lastCheckedIndex.current !== null && index >= 0) {
        const [lo, hi] = [Math.min(lastCheckedIndex.current, index), Math.max(lastCheckedIndex.current, index)]
        const turnOn = !prev.has(id)
        for (let i = lo; i <= hi; i++) {
          if (turnOn) next.add(rows[i].id)
          else next.delete(rows[i].id)
        }
      } else if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    if (index >= 0) lastCheckedIndex.current = index
  }

  function toggleSelectAll() {
    setSelectedIds(prev => {
      const allSelected = rows.length > 0 && rows.every(row => prev.has(row.id))
      if (allSelected) return new Set()
      return new Set(rows.map(row => row.id))
    })
    lastCheckedIndex.current = null
  }

  // All actions are optimistic: the row disappears instantly and the server
  // syncs in the background. On failure the list reloads and shows the error.
  function syncInBackground(work: () => Promise<void>) {
    setSyncing(n => n + 1)
    work()
      .catch(async e => {
        setError(e instanceof Error ? e.message : "Action failed — list reloaded")
        await loadItems()
      })
      .finally(() => setSyncing(n => n - 1))
  }

  function bulkAction(action: "dismiss" | "accept", personId?: string) {
    const targets = action === "accept" && !personId
      ? selectedInView.filter(row => row.candidatePersonId)
      : selectedInView
    const ids = targets.map(row => row.id)
    if (ids.length === 0) return
    setError(null)
    setNotice(null)
    removeItems(ids)
    syncInBackground(async () => {
      const res = await fetch("/api/inbox/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids, personId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Bulk action failed")
      if (data.errors?.length) throw new Error(`${data.errors.length} item(s) failed`)
      const verb = action === "dismiss" ? "Dismissed" : "Accepted"
      setNotice(`${verb} ${data.processed}${data.skipped > 0 ? ` · ${data.skipped} skipped` : ""}`)
    })
  }

  function dismissOne(id: string) {
    setError(null)
    removeItems([id])
    syncInBackground(async () => {
      const res = await fetch(`/api/inbox/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error?.message || data.error || "Could not dismiss item")
      }
    })
  }

  function acceptOne(item: InboxItem, personId?: string, summary?: string) {
    const targetPersonId = personId ?? item.candidatePersonId
    if (!targetPersonId) return
    setError(null)
    removeItems([item.id])
    syncInBackground(async () => {
      const res = await fetch(`/api/inbox/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "accept",
          personId: targetPersonId,
          summary: summary ?? item.summary ?? undefined,
          direction: item.direction,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error?.message || data.error || "Could not accept item")
      }
    })
  }

  function removeItems(ids: string[]) {
    const gone = new Set(ids)
    setItems(prev => prev.filter(item => !gone.has(item.id)))
    setTotal(prev => prev === null ? prev : Math.max(0, prev - ids.length))
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
    setExpandedId(prev => (prev && gone.has(prev) ? null : prev))
  }

  function patchItem(id: string, patch: Partial<InboxItem>) {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item))
  }

  const allSelected = rows.length > 0 && rows.every(row => selectedIds.has(row.id))

  return (
    <div style={{ minHeight: "calc(100vh - 52px)", background: "var(--bg)" }}>
      <style>{`
        .inbox-row .row-hover-actions { opacity: 0; }
        .inbox-row:hover .row-hover-actions { opacity: 1; }
        .inbox-row:hover .row-date { opacity: 0; }
        .inbox-row:hover { background: var(--surface2) !important; }
      `}</style>
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "24px 24px 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
            <h1 style={{ margin: 0, fontSize: "20px", color: "var(--ink)", fontWeight: 600 }}>Inbox</h1>
            <span style={{ fontSize: "12px", color: "var(--ink-4)" }}>{total ?? rows.length} to review</span>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>j/k move · x select · e dismiss · ⏎ open</span>
            <button onClick={loadItems} disabled={loading} style={ghostBtnStyle}>↻ Refresh</button>
          </div>
        </div>

        {/* Source filters */}
        {sources.length > 1 && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
            <button onClick={() => setSourceFilter(null)} style={filterPillStyle(sourceFilter === null)}>All</button>
            {sources.map(src => (
              <button key={src} onClick={() => setSourceFilter(src)} style={filterPillStyle(sourceFilter === src)}>{sourceLabel(src)}</button>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div style={{
          position: "sticky", top: 0, zIndex: 5,
          display: "flex", alignItems: "center", gap: "14px",
          flexWrap: "wrap",
          padding: "8px 12px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "8px 8px 0 0",
          borderBottom: "none",
        }}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            style={{ cursor: "pointer", width: "14px", height: "14px" }}
            title={allSelected ? "Deselect all" : "Select all"}
          />
          {selectedIds.size === 0 ? (
            <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>Select items for bulk actions</span>
          ) : (
            <>
              <span style={{ fontSize: "12px", color: "var(--ink)", fontWeight: 600 }}>{selectedIds.size} selected</span>
              <button onClick={() => bulkAction("dismiss")} style={toolbarBtnStyle}>
                Dismiss {selectedIds.size}
              </button>
              {matchedInSelection > 0 && (
                <button onClick={() => bulkAction("accept")} style={{ ...toolbarBtnStyle, borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-soft)" }}>
                  Accept {matchedInSelection} matched
                </button>
              )}
              <input
                type="search"
                value={bulkPersonSearch}
                onChange={event => {
                  setBulkPersonSearch(event.target.value)
                  setBulkPerson(null)
                }}
                placeholder="Find one Person…"
                aria-label="Search for the Person to receive selected inbox items"
                style={{ ...bulkInputStyle, width: "150px" }}
              />
              {bulkPersonResults.length > 0 && (
                <select
                  value={bulkPerson?.id ?? ""}
                  onChange={event => setBulkPerson(bulkPersonResults.find(person => person.id === event.target.value) ?? null)}
                  aria-label="Person for selected inbox items"
                  style={{ ...bulkInputStyle, width: "170px" }}
                >
                  <option value="">Choose Person…</option>
                  {bulkPersonResults.map(person => (
                    <option key={person.id} value={person.id}>{person.first} {person.last}</option>
                  ))}
                </select>
              )}
              {bulkPerson && (
                <button
                  onClick={() => bulkAction("accept", bulkPerson.id)}
                  disabled={syncing > 0}
                  style={{ ...toolbarBtnStyle, borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-soft)" }}
                >
                  Add {selectedInView.length} to {bulkPerson.first} {bulkPerson.last}
                </button>
              )}
              <button onClick={() => { setSelectedIds(new Set()); lastCheckedIndex.current = null }} style={ghostBtnStyle}>Clear</button>
            </>
          )}
          {syncing > 0 && <span style={{ fontSize: "11px", color: "var(--ink-4)", marginLeft: "auto" }}>syncing…</span>}
        </div>

        {/* Messages */}
        {(notice || error) && (
          <div style={{
            padding: "8px 12px", fontSize: "12px",
            border: "1px solid var(--border)", borderBottom: "none",
            background: error ? "#fff4eb" : "var(--surface)",
            color: error ? "#914a22" : "var(--ink-3)",
          }}>
            {error ?? notice}
          </div>
        )}

        {/* List */}
        <div style={{ border: "1px solid var(--border)", borderRadius: "0 0 8px 8px", background: "var(--surface)", overflow: "hidden" }}>
          {loading && <div style={{ padding: "24px", fontSize: "12px", color: "var(--ink-3)" }}>Loading…</div>}

          {!loading && rows.length === 0 && (
            <div style={{ padding: "48px 24px", textAlign: "center" }}>
              <div style={{ fontSize: "16px", color: "var(--ink)", marginBottom: "4px" }}>All clear</div>
              <div style={{ fontSize: "12px", color: "var(--ink-3)" }}>Automations will place uncertain records here.</div>
            </div>
          )}

          {rows.map((item, index) => (
            <InboxRow
              key={item.id}
              item={item}
              index={index}
              focused={index === focusedIndex}
              checked={selectedIds.has(item.id)}
              expanded={expandedId === item.id}
              onCheck={shiftKey => toggleSelect(item.id, shiftKey)}
              onOpen={() => { setFocusedIndex(index); setExpandedId(id => id === item.id ? null : item.id) }}
              onDismiss={() => dismissOne(item.id)}
              onAccept={(personId, summary) => acceptOne(item, personId, summary)}
              onPatch={patch => patchItem(item.id, patch)}
              setError={setError}
            />
          ))}

          {nextCursor && (
            <div ref={sentinelRef} style={{ padding: "14px", textAlign: "center", fontSize: "11px", color: "var(--ink-4)", borderTop: "1px solid var(--border)" }}>
              Loading more…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InboxRow({
  item, index, focused, checked, expanded,
  onCheck, onOpen, onDismiss, onAccept, onPatch, setError,
}: {
  item: InboxItem
  index: number
  focused: boolean
  checked: boolean
  expanded: boolean
  onCheck: (shiftKey: boolean) => void
  onOpen: () => void
  onDismiss: () => void
  onAccept: (personId?: string, summary?: string) => void
  onPatch: (patch: Partial<InboxItem>) => void
  setError: (e: string | null) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focused && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest" })
    }
  }, [focused])

  const name = item.contactName || item.contactEmail || item.contactPhone || "Unknown"
  const snippet = item.summary || "(no text)"

  return (
    <div>
      <div
        ref={rowRef}
        className="inbox-row"
        style={{
          display: "flex", alignItems: "center", gap: "12px",
          padding: "0 12px",
          height: "42px",
          borderTop: index === 0 ? "none" : "1px solid var(--border)",
          background: checked ? "var(--accent-soft)" : expanded ? "var(--surface2)" : "var(--surface)",
          boxShadow: focused ? "inset 2px 0 0 var(--accent)" : "none",
          cursor: "pointer",
          position: "relative",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => {}}
          onClick={e => { e.stopPropagation(); onCheck(e.shiftKey) }}
          style={{ cursor: "pointer", width: "14px", height: "14px", flexShrink: 0 }}
        />

        <div onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0, height: "100%" }}>
          <span style={{
            width: "180px", flexShrink: 0,
            fontSize: "12.5px", fontWeight: 600, color: "var(--ink)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {name}
          </span>

          {item.candidatePerson && (
            <span style={{
              flexShrink: 0, fontSize: "10px", padding: "1px 7px", borderRadius: "999px",
              border: "1px solid #88a06a", color: "#526b37", background: "#f3f7ee",
              whiteSpace: "nowrap",
            }}>
              → {item.candidatePerson.first} {item.candidatePerson.last}
            </span>
          )}
          {item.status === "blocked" && (
            <span style={{ flexShrink: 0, fontSize: "10px", padding: "1px 7px", borderRadius: "999px", border: "1px solid #d28a5d", color: "#914a22", background: "#fff4eb" }}>
              blocked
            </span>
          )}
          {item.hasSuggestions && (
            <span style={{ flexShrink: 0, fontSize: "10px", padding: "1px 7px", borderRadius: "999px", border: "1px solid #8a7abd", color: "#4a3a8a", background: "#f0eefb" }}>
              suggestions
            </span>
          )}

          <span style={{
            flex: 1, minWidth: 0,
            fontSize: "12px", color: "var(--ink-3)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {snippet}
          </span>

          <span style={{
            flexShrink: 0,
            fontSize: "10px",
            color: "var(--cognac-deep)",
            background: "var(--cognac-soft)",
            borderRadius: "var(--radius-pill)",
            padding: "2px 7px",
          }}>
            {sourceLabel(item.source)}
          </span>
        </div>

        {/* Date / hover actions occupy the same slot, Gmail-style */}
        <div style={{ width: "90px", flexShrink: 0, position: "relative", height: "100%" }}>
          <span className="row-date" style={{
            position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
            fontSize: "11px", color: "var(--ink-4)", whiteSpace: "nowrap",
          }}>
            {formatDate(item.timestamp)}
          </span>
          <span className="row-hover-actions" style={{
            position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
            display: "flex", gap: "4px",
          }}>
            {item.candidatePersonId && (
              <button
                title="Accept — log to matched person"
                onClick={e => { e.stopPropagation(); onAccept() }}
                style={iconBtnStyle("#526b37", "#f3f7ee", "#88a06a")}
              >
                ✓
              </button>
            )}
            <button
              title="Dismiss"
              onClick={e => { e.stopPropagation(); onDismiss() }}
              style={iconBtnStyle("var(--ink-3)", "var(--surface)", "var(--border)")}
            >
              ✕
            </button>
          </span>
        </div>
      </div>

      {expanded && (
        <ExpandedDetail
          item={item}
          onAccept={onAccept}
          onDismiss={onDismiss}
          onPatch={onPatch}
          setError={setError}
        />
      )}
    </div>
  )
}

function sourceLabel(source: string) {
  if (source === "imessage") return "iMessage"
  if (source === "gmail") return "Email"
  if (source === "whatsapp") return "WhatsApp"
  return source
}

function ExpandedDetail({
  item, onAccept, onDismiss, onPatch, setError,
}: {
  item: InboxItem
  onAccept: (personId?: string, summary?: string) => void
  onDismiss: () => void
  onPatch: (patch: Partial<InboxItem>) => void
  setError: (e: string | null) => void
}) {
  const [detail, setDetail] = useState<InboxDetail | null>(null)
  const [summary, setSummary] = useState(item.summary ?? "")
  const summaryDirty = useRef(false)
  const [selectedPerson, setSelectedPerson] = useState<PersonRef | null>(item.candidatePerson)
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<PersonRef[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const parsedName = splitPersonName(item.contactName)
  const [newPerson, setNewPerson] = useState({
    first: parsedName.first,
    last: parsedName.last,
    email: item.contactEmail ?? "",
    phone: item.contactPhone ?? "",
    title: "",
    company: "",
  })
  const [busy, setBusy] = useState(false)

  // Fetch full detail (untruncated summary, body, rule runs) on expand.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/inbox/${item.id}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled || !data) return
        setDetail(data)
        if (!summaryDirty.current) setSummary(data.summary ?? data.body ?? "")
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [item.id])

  useEffect(() => {
    if (!search.trim()) {
      setResults([])
      return
    }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/persons?minimal=true&search=${encodeURIComponent(search)}&limit=8`)
      const data = res.ok ? await res.json() : {}
      setResults(data.persons ?? [])
    }, 180)
    return () => clearTimeout(timer)
  }, [search])

  async function attachPerson(person: PersonRef) {
    setSelectedPerson(person)
    setBusy(true)
    try {
      const res = await fetch(`/api/inbox/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", personId: person.id, summary, direction: item.direction }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not attach Person")
      onPatch({ candidatePersonId: person.id, candidatePerson: person, summary })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not attach Person")
    } finally {
      setBusy(false)
    }
  }

  async function createPerson(acceptAfter: boolean) {
    if (!newPerson.first.trim()) {
      setError("Add a first name before creating the Person.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/persons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first: newPerson.first,
          last: newPerson.last,
          title: newPerson.title,
          company: newPerson.company,
          emails: newPerson.email.trim() ? [newPerson.email.trim()] : [],
          phones: newPerson.phone.trim() ? [newPerson.phone.trim()] : [],
          closeness: 2,
          tags: [],
          values: [],
        }),
      })
      const created = await res.json()
      if (!res.ok) throw new Error(created.error || "Could not create Person")
      const person: PersonRef = {
        id: created.id, first: created.first, last: created.last,
        title: created.title, company: created.company,
        emails: created.emails ?? [], phones: created.phones ?? [],
      }
      if (acceptAfter) {
        onAccept(person.id, summary)
      } else {
        setShowCreate(false)
        await attachPerson(person)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create Person")
    } finally {
      setBusy(false)
    }
  }

  async function returnToReview() {
    setBusy(true)
    try {
      const res = await fetch(`/api/inbox/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", personId: selectedPerson?.id ?? item.candidatePersonId, summary, direction: item.direction, status: "pending" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not update item")
      onPatch({ status: "pending", summary })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update item")
    } finally {
      setBusy(false)
    }
  }

  async function applyRunSuggestions(ruleRunId: string) {
    setApplying(ruleRunId)
    setError(null)
    try {
      const res = await fetch(`/api/inbox/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply_suggestions", ruleRunIds: [ruleRunId] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not apply suggestions")
      setDetail(prev => prev ? {
        ...prev,
        ruleRuns: prev.ruleRuns.map(run =>
          run.id === ruleRunId ? { ...run, status: "applied", actionsApplied: run.actionsPlanned } : run
        ),
      } : prev)
      onPatch({ hasSuggestions: false })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply suggestions")
    } finally {
      setApplying(null)
    }
  }

  const pendingSuggestions = (detail?.ruleRuns ?? []).filter(run => run.mode === "suggest" && run.matched && run.status === "suggested" && actionCount(run.actionsPlanned) > 0)
  const disabled = busy

  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg)", padding: "16px 40px 18px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "20px" }}>

        {/* Left: message */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>
              {sourceLabel(item.source)} · {item.direction || "message"} · {formatDateTime(item.timestamp)}
            </span>
          </div>
          <textarea
            value={summary}
            onChange={e => { summaryDirty.current = true; setSummary(e.target.value) }}
            rows={5}
            style={{
              width: "100%", boxSizing: "border-box",
              border: "1px solid var(--border)", borderRadius: "8px",
              padding: "10px 12px", background: "var(--surface)", color: "var(--ink)",
              font: "inherit", fontSize: "12.5px", lineHeight: 1.5, resize: "vertical",
            }}
          />
          {!detail && (
            <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--ink-4)" }}>Loading detail…</div>
          )}
          {detail?.body && detail.body !== summary && (
            <details style={{ marginTop: "8px" }}>
              <summary style={{ fontSize: "11px", color: "var(--ink-4)", cursor: "pointer" }}>Original text</summary>
              <div style={{ fontSize: "12px", color: "var(--ink-3)", lineHeight: 1.5, marginTop: "6px", whiteSpace: "pre-wrap", maxHeight: "200px", overflowY: "auto" }}>
                {detail.body}
              </div>
            </details>
          )}

          {pendingSuggestions.length > 0 && (
            <div style={{ marginTop: "12px", display: "grid", gap: "6px" }}>
              {pendingSuggestions.map(run => (
                <div key={run.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", border: "1px solid #8a7abd", background: "#f0eefb", borderRadius: "7px", padding: "7px 10px" }}>
                  <span style={{ fontSize: "11px", color: "#4a3a8a" }}>
                    {run.rule.name}: {actionCount(run.actionsPlanned)} suggested change{actionCount(run.actionsPlanned) === 1 ? "" : "s"}
                  </span>
                  <button
                    onClick={() => applyRunSuggestions(run.id)}
                    disabled={applying === run.id}
                    style={{ padding: "3px 10px", borderRadius: "5px", border: "1px solid #8a7abd", background: "#fff", color: "#4a3a8a", font: "inherit", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
                  >
                    {applying === run.id ? "Applying…" : "Apply"}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
            <button
              onClick={() => onAccept(selectedPerson?.id, summary)}
              disabled={disabled || !selectedPerson}
              style={{
                padding: "8px 16px", borderRadius: "7px", border: "none",
                background: selectedPerson ? "var(--accent)" : "var(--border)",
                color: selectedPerson ? "#fff" : "var(--ink-4)",
                font: "inherit", fontSize: "12px", fontWeight: 600,
                cursor: disabled || !selectedPerson ? "not-allowed" : "pointer",
              }}
            >
              Accept → {selectedPerson ? `${selectedPerson.first} ${selectedPerson.last}` : "choose person"}
            </button>
            <button onClick={onDismiss} disabled={disabled} style={{ ...toolbarBtnStyle, padding: "8px 14px" }}>Dismiss</button>
            {item.status === "blocked" && (
              <button onClick={returnToReview} disabled={disabled} style={{ padding: "8px 14px", borderRadius: "7px", border: "1px solid #d28a5d", background: "#fff4eb", color: "#914a22", font: "inherit", fontSize: "12px", cursor: "pointer" }}>
                Return to Review
              </button>
            )}
          </div>
        </div>

        {/* Right: person attach */}
        <div>
          <div style={{ fontSize: "10px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
            Attach to
          </div>

          {selectedPerson && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", border: "1px solid #88a06a", background: "#f3f7ee", borderRadius: "7px", marginBottom: "8px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "#526b37" }}>{selectedPerson.first} {selectedPerson.last}</div>
                <div style={{ fontSize: "10px", color: "var(--ink-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {[selectedPerson.title, selectedPerson.company, selectedPerson.emails[0]].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Link href={`/persons/${selectedPerson.id}`} style={{ fontSize: "11px", color: "var(--accent)", textDecoration: "none", flexShrink: 0 }}>
                Open
              </Link>
            </div>
          )}

          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search people…"
            style={{
              width: "100%", boxSizing: "border-box",
              border: "1px solid var(--border)", borderRadius: "7px",
              padding: "8px 10px", background: "var(--surface)", color: "var(--ink)",
              font: "inherit", fontSize: "12px",
            }}
          />

          {results.length > 0 && (
            <div style={{ display: "grid", gap: "4px", marginTop: "6px" }}>
              {results.map(person => (
                <button
                  key={person.id}
                  onClick={() => attachPerson(person)}
                  style={{
                    textAlign: "left", padding: "7px 9px",
                    border: "1px solid var(--border)", borderRadius: "6px",
                    background: selectedPerson?.id === person.id ? "var(--accent-soft)" : "var(--surface)",
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink)" }}>{person.first} {person.last}</div>
                  <div style={{ fontSize: "10px", color: "var(--ink-4)" }}>
                    {[person.title, person.company, person.emails[0]].filter(Boolean).join(" · ")}
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowCreate(open => !open)}
            style={{ marginTop: "8px", padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)", background: showCreate ? "var(--accent-soft)" : "transparent", color: showCreate ? "var(--accent)" : "var(--ink-3)", font: "inherit", fontSize: "11px", cursor: "pointer" }}
          >
            + New person
          </button>

          {showCreate && (
            <div style={{ display: "grid", gap: "8px", marginTop: "10px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <SmallField label="First" value={newPerson.first} onChange={v => setNewPerson(p => ({ ...p, first: v }))} />
                <SmallField label="Last (optional)" value={newPerson.last} onChange={v => setNewPerson(p => ({ ...p, last: v }))} />
              </div>
              <SmallField label="Email" value={newPerson.email} onChange={v => setNewPerson(p => ({ ...p, email: v }))} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <SmallField label="Title" value={newPerson.title} onChange={v => setNewPerson(p => ({ ...p, title: v }))} />
                <SmallField label="Company" value={newPerson.company} onChange={v => setNewPerson(p => ({ ...p, company: v }))} />
              </div>
              <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                <button onClick={() => createPerson(false)} disabled={disabled} style={{ ...ghostBtnStyle, padding: "6px 10px" }}>Create & Attach</button>
                <button onClick={() => createPerson(true)} disabled={disabled} style={{ padding: "6px 10px", borderRadius: "6px", border: "none", background: "var(--accent)", color: "#fff", font: "inherit", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>
                  Create & Accept
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function iconBtnStyle(color: string, background: string, border: string): React.CSSProperties {
  return {
    width: "26px", height: "26px",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: "6px",
    border: `1px solid ${border}`,
    background,
    color,
    font: "inherit", fontSize: "12px",
    cursor: "pointer",
    padding: 0,
  }
}

const toolbarBtnStyle: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--ink-2)",
  font: "inherit",
  fontSize: "11px",
  fontWeight: 600,
  cursor: "pointer",
}

const bulkInputStyle: React.CSSProperties = {
  minHeight: "30px",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--ink)",
  padding: "5px 10px",
  font: "inherit",
  fontSize: "11px",
}

const ghostBtnStyle: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--ink-4)",
  font: "inherit",
  fontSize: "11px",
  cursor: "pointer",
}

function filterPillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "3px 10px",
    borderRadius: "999px",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--accent)" : "var(--ink-4)",
    font: "inherit",
    fontSize: "11px",
    cursor: "pointer",
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date)
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat("en", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "2-digit" }).format(date)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function actionCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function splitPersonName(value: string | null) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: "", last: "" }
  if (parts.length === 1) return { first: parts[0], last: "" }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

function SmallField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: "grid", gap: "4px", color: "var(--ink-4)", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {label}
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: "6px", padding: "7px 8px", background: "var(--surface)", color: "var(--ink)", font: "inherit", fontSize: "12px", textTransform: "none", letterSpacing: 0 }}
      />
    </label>
  )
}
