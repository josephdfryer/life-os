"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

type RecentMergeEntry = {
  auditLogId: string
  createdAt: string
  mode: string
  actorLabel: string | null
  pending: { deleteId: string; name: string }[]
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}

const MODE_LABEL: Record<string, string> = {
  pair: "manually",
  batch: "manually, in a batch",
  cluster: "manually, in a batch",
  "same-email": "automatically (same email)",
  dedupe: "automatically",
}

export default function AutoMergePanel() {
  const router = useRouter()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [savingToggle, setSavingToggle] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<RecentMergeEntry[] | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/contacts/auto-merge-settings")
      .then(res => res.json())
      .then(data => setEnabled(!!data.autoMergeEnabled))
      .catch(() => setEnabled(false))
  }, [])

  async function toggle() {
    if (enabled === null || savingToggle) return
    const next = !enabled
    setSavingToggle(true)
    setEnabled(next)
    try {
      const res = await fetch("/api/contacts/auto-merge-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoMergeEnabled: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      setEnabled(!next)
      setError("Couldn't save that — try again.")
    }
    setSavingToggle(false)
  }

  async function loadHistory() {
    const opening = !historyOpen
    setHistoryOpen(opening)
    if (opening && history === null) {
      try {
        const res = await fetch("/api/contacts/recent-merges")
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setHistory(await res.json())
      } catch {
        setHistory([])
        setError("Couldn't load recent merges.")
      }
    }
  }

  async function undo(auditLogId: string, deleteId: string) {
    setUndoing(deleteId)
    setError(null)
    try {
      const res = await fetch("/api/contacts/merge-undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId, deleteId }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setHistory(prev =>
        (prev ?? [])
          .map(e => e.auditLogId === auditLogId ? { ...e, pending: e.pending.filter(p => p.deleteId !== deleteId) } : e)
          .filter(e => e.pending.length > 0)
      )
      router.refresh()
    } catch {
      setError("Couldn't undo that merge — try again.")
    }
    setUndoing(null)
  }

  return (
    <div style={{ marginBottom: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--ink)", marginBottom: "3px" }}>
            Auto-merge exact duplicates
          </div>
          <div style={{ fontSize: "11px", color: "var(--ink-3)" }}>
            When you import contacts, automatically merge the ones that clearly match (same email, same phone, or near-identical name). Everything stays undoable below.
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={enabled === null || savingToggle}
          aria-pressed={!!enabled}
          style={{
            flexShrink: 0,
            width: "38px",
            height: "22px",
            borderRadius: "999px",
            border: "none",
            background: enabled ? "var(--accent)" : "var(--border)",
            position: "relative",
            cursor: enabled === null ? "default" : "pointer",
            opacity: enabled === null ? 0.5 : 1,
            transition: "background 0.15s",
            padding: 0,
          }}
        >
          <span style={{
            position: "absolute",
            top: "2px",
            left: enabled ? "18px" : "2px",
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
            transition: "left 0.15s",
          }} />
        </button>
      </div>

      <div style={{ borderTop: "1px solid var(--border)" }}>
        <button
          onClick={loadHistory}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "10px 18px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "11px",
            color: "var(--ink-3)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ transform: historyOpen ? "rotate(90deg)" : "none", transition: "transform 0.12s", display: "inline-block", fontSize: "9px" }}>▶</span>
          Recent merges
        </button>

        {historyOpen && (
          <div style={{ padding: "0 18px 14px" }}>
            {history === null ? (
              <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>Loading…</div>
            ) : history.length === 0 ? (
              <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>No merges yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {history.map(entry => entry.pending.map(p => (
                  <div key={`${entry.auditLogId}-${p.deleteId}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "7px" }}>
                    <div style={{ fontSize: "11px", color: "var(--ink-2)" }}>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      <span style={{ color: "var(--ink-4)" }}> merged {MODE_LABEL[entry.mode] ?? "manually"} · {timeAgo(entry.createdAt)}</span>
                    </div>
                    <button
                      onClick={() => undo(entry.auditLogId, p.deleteId)}
                      disabled={undoing === p.deleteId}
                      style={{ flexShrink: 0, fontSize: "11px", color: "var(--accent)", background: "transparent", border: "1px solid var(--accent)", borderRadius: "6px", padding: "3px 10px", cursor: undoing === p.deleteId ? "wait" : "pointer", fontFamily: "inherit", opacity: undoing === p.deleteId ? 0.6 : 1 }}
                    >
                      {undoing === p.deleteId ? "Undoing…" : "Undo"}
                    </button>
                  </div>
                )))}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: "8px 18px", borderTop: "1px solid var(--border)", fontSize: "11px", color: "#b91c1c" }}>
          {error}
        </div>
      )}
    </div>
  )
}
