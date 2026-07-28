"use client"

import { useEffect, useRef, useState } from "react"

type Communication = {
  id: string
  ids: string[]
  source: string
  contact: string
  summary: string
  body: string | null
  timestamp: string
  direction: string | null
  candidatePersonId: string | null
  candidatePersonName: string | null
  messageCount: number
  priority: number
}

export default function CommunicationsReview({
  initialItems,
  personsUrl,
}: {
  initialItems: Communication[]
  personsUrl: string
}) {
  const [items, setItems] = useState(initialItems)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(0)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const lastCheckedIndex = useRef<number | null>(null)
  const focusedRowRef = useRef<HTMLElement | null>(null)

  const allSelected = items.length > 0 && items.every(item => selectedIds.has(item.id))

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT"
        || target.isContentEditable
      ) return
      if (items.length === 0) return

      const currentIndex = Math.min(focusedIndex, items.length - 1)
      const focused = items[currentIndex]
      if (event.key === "j") {
        event.preventDefault()
        setFocusedIndex(index => Math.min(index + 1, items.length - 1))
      } else if (event.key === "k") {
        event.preventDefault()
        setFocusedIndex(index => Math.max(index - 1, 0))
      } else if (event.key === "x") {
        event.preventDefault()
        toggleSelect(focused.id)
      } else if (event.key === "e") {
        event.preventDefault()
        if (selectedIds.size > 0) void dismissSelected()
        else void resolve(focused, "dismiss")
      } else if (event.key === "Enter") {
        event.preventDefault()
        setExpandedId(current => current === focused.id ? null : focused.id)
      } else if (event.key === "Escape") {
        setExpandedId(null)
      }
    }

    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [focusedIndex, items, selectedIds])

  useEffect(() => {
    focusedRowRef.current?.scrollIntoView({ block: "nearest" })
  }, [focusedIndex])

  function toggleSelect(id: string, shiftKey = false) {
    const index = items.findIndex(item => item.id === id)
    setSelectedIds(current => {
      const next = new Set(current)
      if (shiftKey && lastCheckedIndex.current !== null && index >= 0) {
        const [low, high] = [
          Math.min(lastCheckedIndex.current, index),
          Math.max(lastCheckedIndex.current, index),
        ]
        const selectRange = !current.has(id)
        for (let itemIndex = low; itemIndex <= high; itemIndex += 1) {
          if (selectRange) next.add(items[itemIndex].id)
          else next.delete(items[itemIndex].id)
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
    setSelectedIds(current => (
      items.length > 0 && items.every(item => current.has(item.id))
        ? new Set()
        : new Set(items.map(item => item.id))
    ))
    lastCheckedIndex.current = null
  }

  function clearSelection() {
    setSelectedIds(new Set())
    lastCheckedIndex.current = null
  }

  async function dismissSelected() {
    const ids = items.filter(item => selectedIds.has(item.id)).flatMap(item => item.ids)
    if (ids.length === 0) return

    const dismissed = items.filter(item => selectedIds.has(item.id))
    setItems(current => current.filter(item => !selectedIds.has(item.id)))
    clearSelection()
    setExpandedId(current => current && ids.includes(current) ? null : current)
    setError("")
    setNotice("")
    setSyncing(current => current + 1)

    try {
      const response = await fetch("/api/communications/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", ids }),
      })
      const body = await response.json().catch(() => null) as {
        error?: string
        processed?: number
        skipped?: number
      } | null
      if (!response.ok) throw new Error(body?.error || "Bulk dismiss failed")
      setNotice(`Dismissed ${body?.processed ?? ids.length}${body?.skipped ? ` · ${body.skipped} skipped` : ""}`)
    } catch (dismissError) {
      setItems(current => {
        const present = new Set(current.map(item => item.id))
        return [...dismissed.filter(item => !present.has(item.id)), ...current]
      })
      setError(dismissError instanceof Error ? dismissError.message : "Bulk dismiss failed")
    } finally {
      setSyncing(current => current - 1)
    }
  }

  async function resolve(item: Communication, action: "accept" | "dismiss") {
    if (busyId) return
    setBusyId(item.id)
    setError("")
    setNotice("")
    try {
      if (action === "dismiss" && item.ids.length > 1) {
        const response = await fetch("/api/communications/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ids: item.ids }),
        })
        const body = await response.json().catch(() => null) as { error?: string } | null
        if (!response.ok) throw new Error(body?.error || "Could not dismiss these communications")
      } else {
        for (const id of item.ids) {
          const response = await fetch(`/api/communications/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          })
          const body = await response.json().catch(() => null) as { error?: string } | null
          if (!response.ok) throw new Error(body?.error || "Could not review this communication")
        }
      }
      setItems(current => current.filter(currentItem => currentItem.id !== item.id))
      setSelectedIds(current => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
      setExpandedId(current => current === item.id ? null : current)
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not review this communication")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="communications-review" aria-labelledby="communications-heading">
      <div className="communications-heading">
        <div>
          <div className="quick-capture-eyebrow">Messages & email</div>
          <h2 id="communications-heading">Review communications</h2>
        </div>
        <div className="communications-heading-meta">
          <span>j/k move · x select · e dismiss · ⏎ open</span>
          <span>{items.length} here</span>
        </div>
      </div>
      {items.length ? (
        <>
          <div className="communications-selection-toolbar">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              aria-label={allSelected ? "Deselect all communications" : "Select all communications"}
            />
            {selectedIds.size === 0 ? (
              <span>Select items for bulk actions</span>
            ) : (
              <>
                <strong>{selectedIds.size} selected</strong>
                <button type="button" onClick={dismissSelected}>Dismiss {selectedIds.size}</button>
                <button type="button" onClick={clearSelection}>Clear</button>
              </>
            )}
            {syncing > 0 ? <span className="communications-syncing">syncing…</span> : null}
          </div>
          <div className="communications-list">
            {items.map((item, index) => {
              const expanded = expandedId === item.id
              const checked = selectedIds.has(item.id)
              const focused = index === Math.min(focusedIndex, items.length - 1)
              const canAccept = Boolean(item.candidatePersonId)
              return (
                <article
                  key={item.id}
                  ref={focused ? focusedRowRef : undefined}
                  className={`communication-card${checked ? " is-selected" : ""}${focused ? " is-focused" : ""}`}
                >
                  <div className="communication-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {}}
                      onClick={event => {
                        setFocusedIndex(index)
                        toggleSelect(item.id, event.shiftKey)
                      }}
                      aria-label={`Select communication from ${item.contact}`}
                    />
                    <button
                      type="button"
                      className="communication-summary"
                      aria-expanded={expanded}
                      onClick={() => {
                        setFocusedIndex(index)
                        setExpandedId(current => current === item.id ? null : item.id)
                      }}
                    >
                      <span className={`communication-source source-${item.source}`}>{sourceLabel(item.source)}</span>
                      <span className="communication-person">
                        <strong>{item.contact}</strong>
                        <small>{formatTimestamp(item.timestamp)}{item.direction ? ` · ${item.direction}` : ""}</small>
                      </span>
                      <span className="communication-preview">{item.summary}</span>
                      <span aria-hidden="true">{expanded ? "−" : "+"}</span>
                    </button>
                  </div>
                  {expanded && (
                    <div className="communication-detail">
                      {item.body && item.body !== item.summary ? <p>{item.body}</p> : null}
                      <div className="communication-actions">
                        {canAccept ? (
                          <button
                            type="button"
                            className="capture-submit"
                            disabled={busyId === item.id}
                            onClick={() => resolve(item, "accept")}
                          >
                            Add to {item.candidatePersonName}
                          </button>
                        ) : (
                          <a href={`${personsUrl}/inbox`}>Choose a Person in Persons</a>
                        )}
                        <button type="button" disabled={busyId === item.id} onClick={() => resolve(item, "dismiss")}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </>
      ) : (
        <div className="capture-analysis-status">Messages and email are all reviewed.</div>
      )}
      {error ? <div className="capture-analysis-status error" role="alert">{error}</div> : null}
      {notice ? <div className="capture-analysis-status" role="status">{notice}</div> : null}
      <a className="communications-all-link" href={`${personsUrl}/inbox`}>Open the full communications inbox →</a>
    </section>
  )
}

function sourceLabel(source: string) {
  if (source === "imessage") return "iMessage"
  if (source === "gmail") return "Email"
  return source
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
