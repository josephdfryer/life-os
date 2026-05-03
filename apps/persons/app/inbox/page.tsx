"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
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
  confidence: number | null
  matchReason: string | null
  type: string
  timestamp: string
  summary: string | null
  body: string | null
  direction: string | null
  createdAt: string
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

type SearchResult = {
  id: string
  first: string
  last: string
  title: string | null
  company: string | null
  emails: string[]
  phones: string[]
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedPerson, setSelectedPerson] = useState<PersonRef | null>(null)
  const [summary, setSummary] = useState("")

  const selected = useMemo(
    () => items.find(item => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  )

  useEffect(() => {
    loadItems()
  }, [])

  useEffect(() => {
    if (!selected) return
    setSelectedPerson(selected.candidatePerson)
    setSummary(selected.summary ?? selected.body ?? "")
    setSearch("")
    setResults([])
  }, [selected?.id])

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

  async function loadItems() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/inbox?status=review&limit=200")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not load inbox")
      setItems(data.items ?? [])
      setSelectedId((data.items ?? [])[0]?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load inbox")
    } finally {
      setLoading(false)
    }
  }

  async function acceptSelected() {
    if (!selected || !selectedPerson) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/inbox/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "accept",
          personId: selectedPerson.id,
          summary,
          direction: selected.direction,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not accept item")
      removeItem(selected.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept item")
    } finally {
      setSaving(false)
    }
  }

  async function dismissSelected() {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/inbox/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not dismiss item")
      removeItem(selected.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss item")
    } finally {
      setSaving(false)
    }
  }

  function removeItem(id: string) {
    setItems(prev => {
      const idx = prev.findIndex(item => item.id === id)
      const next = prev.filter(item => item.id !== id)
      setSelectedId(next[Math.min(idx, next.length - 1)]?.id ?? null)
      return next
    })
  }

  return (
    <div style={{ minHeight: "calc(100vh - 52px)", background: "var(--bg)" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)",
        minHeight: "calc(100vh - 52px)",
      }}>
        <aside style={{ borderRight: "1px solid var(--border)", background: "var(--surface)", padding: "18px 14px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "14px" }}>
            <h1 style={{ margin: 0, fontSize: "18px", color: "var(--ink)", fontWeight: 600 }}>Inbox</h1>
            <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>{items.length} to review</span>
          </div>

          {loading && <p style={{ fontSize: "12px", color: "var(--ink-3)" }}>Loading...</p>}
          {!loading && items.length === 0 && (
            <div style={{ padding: "32px 14px", color: "var(--ink-3)", fontSize: "12px", lineHeight: 1.5 }}>
              Nothing pending.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {items.map(item => {
              const active = item.id === selected?.id
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  style={{
                    textAlign: "left",
                    padding: "10px",
                    borderRadius: "8px",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    background: active ? "var(--accent-soft)" : "var(--bg)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "5px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink)" }}>
                      {item.contactName || item.contactEmail || item.contactPhone || "Unknown"}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--ink-4)", whiteSpace: "nowrap" }}>
                      {formatDate(item.timestamp)}
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--ink-3)", lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {item.summary || item.body || "(no text)"}
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
                    {item.status !== "pending" && <TinyPill tone={item.status === "blocked" ? "warn" : "muted"}>{item.status}</TinyPill>}
                    {item.ruleRuns.some(run => run.matched) && <TinyPill tone="ok">rule matched</TinyPill>}
                    {item.ruleRuns.some(run => actionCount(run.actionsApplied) > 0) && <TinyPill tone="accent">auto updated</TinyPill>}
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <main style={{ padding: "28px", maxWidth: "900px" }}>
          {!selected && !loading && (
            <div style={{ padding: "48px", border: "1px solid var(--border)", borderRadius: "10px", background: "var(--surface)" }}>
              <h2 style={{ margin: "0 0 6px", fontSize: "20px", color: "var(--ink)" }}>All clear</h2>
              <p style={{ margin: 0, color: "var(--ink-3)", fontSize: "13px" }}>Automations will place uncertain records here.</p>
            </div>
          )}

          {selected && (
            <div style={{ display: "grid", gap: "18px" }}>
              <section style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "8px", padding: "18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", marginBottom: "16px" }}>
                  <div>
                    <div style={{ color: "var(--ink-4)", fontSize: "11px", marginBottom: "4px" }}>{selected.source}</div>
                    <h2 style={{ margin: 0, color: "var(--ink)", fontSize: "22px", fontWeight: 600 }}>
                      {selected.contactName || selected.contactEmail || selected.contactPhone || "Unknown contact"}
                    </h2>
                  </div>
                  <div style={{ textAlign: "right", color: "var(--ink-3)", fontSize: "12px" }}>
                    <div>{formatDateTime(selected.timestamp)}</div>
                    <div>{selected.direction || "message"}</div>
                  </div>
                </div>

                <textarea
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                  rows={5}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "12px",
                    background: "var(--bg)",
                    color: "var(--ink)",
                    font: "inherit",
                    fontSize: "13px",
                    lineHeight: 1.5,
                    resize: "vertical",
                  }}
                />
              </section>

              <section style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "8px", padding: "18px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
                  <h3 style={{ margin: 0, fontSize: "14px", color: "var(--ink)" }}>Automation Trace</h3>
                  <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{selected.ruleRuns.length} checks</span>
                </div>

                {selected.ruleRuns.length === 0 && (
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--ink-3)" }}>No rules have evaluated this item yet.</p>
                )}

                {selected.ruleRuns.length > 0 && (
                  <div style={{ display: "grid", gap: "8px" }}>
                    {selected.ruleRuns.map(run => (
                      <div key={run.id} style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: "12px", color: "var(--ink)", fontWeight: 600 }}>{run.rule.name}</div>
                            <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "2px" }}>{run.trigger} · {run.mode} · {formatDateTime(run.createdAt)}</div>
                          </div>
                          <TinyPill tone={run.matched ? "ok" : "muted"}>{run.matched ? "matched" : "skipped"}</TinyPill>
                        </div>
                        {run.message && <div style={{ fontSize: "11px", color: "var(--ink-3)", marginTop: "8px" }}>{run.message}</div>}
                        {(actionCount(run.actionsPlanned) > 0 || actionCount(run.actionsApplied) > 0) && (
                          <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                            {actionCount(run.actionsPlanned) > 0 && <TinyPill tone="muted">{actionCount(run.actionsPlanned)} planned</TinyPill>}
                            {actionCount(run.actionsApplied) > 0 && <TinyPill tone="accent">{actionCount(run.actionsApplied)} applied</TinyPill>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "8px", padding: "18px" }}>
                <h3 style={{ margin: "0 0 12px", fontSize: "14px", color: "var(--ink)" }}>Attach To</h3>

                {selectedPerson && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "12px", background: "var(--bg)" }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>{selectedPerson.first} {selectedPerson.last}</div>
                      <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>
                        {[selectedPerson.title, selectedPerson.company, selectedPerson.emails[0], selectedPerson.phones[0]].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <Link href={`/contacts/${selectedPerson.id}`} style={{ fontSize: "11px", color: "var(--accent)", textDecoration: "none" }}>
                      Open
                    </Link>
                  </div>
                )}

                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search People"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    background: "var(--bg)",
                    color: "var(--ink)",
                    font: "inherit",
                    fontSize: "13px",
                    marginBottom: results.length ? "10px" : 0,
                  }}
                />

                {results.length > 0 && (
                  <div style={{ display: "grid", gap: "6px" }}>
                    {results.map(person => (
                      <button
                        key={person.id}
                        onClick={() => setSelectedPerson(person)}
                        style={{
                          textAlign: "left",
                          padding: "9px 10px",
                          border: "1px solid var(--border)",
                          borderRadius: "7px",
                          background: selectedPerson?.id === person.id ? "var(--accent-soft)" : "var(--bg)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink)" }}>{person.first} {person.last}</div>
                        <div style={{ fontSize: "10px", color: "var(--ink-4)" }}>
                          {[person.title, person.company, person.emails[0], person.phones[0]].filter(Boolean).join(" · ")}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {error && <p style={{ color: "var(--accent)", fontSize: "12px", margin: 0 }}>{error}</p>}

              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                <button
                  onClick={dismissSelected}
                  disabled={saving}
                  style={{ padding: "10px 16px", borderRadius: "7px", border: "1px solid var(--border)", background: "transparent", color: "var(--ink-3)", font: "inherit", fontSize: "12px", cursor: saving ? "not-allowed" : "pointer" }}
                >
                  Dismiss
                </button>
                <button
                  onClick={acceptSelected}
                  disabled={saving || !selectedPerson}
                  style={{ padding: "10px 18px", borderRadius: "7px", border: "none", background: selectedPerson ? "var(--accent)" : "var(--border)", color: selectedPerson ? "#fff" : "var(--ink-4)", font: "inherit", fontSize: "12px", fontWeight: 600, cursor: saving || !selectedPerson ? "not-allowed" : "pointer" }}
                >
                  Accept
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value))
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

function TinyPill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" | "accent" }) {
  const styles = {
    muted: { border: "var(--border)", color: "var(--ink-4)", background: "var(--surface)" },
    ok: { border: "#88a06a", color: "#526b37", background: "#f3f7ee" },
    warn: { border: "#d28a5d", color: "#914a22", background: "#fff4eb" },
    accent: { border: "var(--accent)", color: "var(--accent)", background: "var(--accent-soft)" },
  }[tone]
  return (
    <span style={{ display: "inline-flex", border: `1px solid ${styles.border}`, color: styles.color, background: styles.background, borderRadius: "999px", padding: "2px 7px", fontSize: "10px", lineHeight: 1.3 }}>
      {children}
    </span>
  )
}
