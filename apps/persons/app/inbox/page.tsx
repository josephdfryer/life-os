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
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedPerson, setSelectedPerson] = useState<PersonRef | null>(null)
  const [summary, setSummary] = useState("")
  const [showCreatePerson, setShowCreatePerson] = useState(false)
  const [newPerson, setNewPerson] = useState({
    first: "",
    last: "",
    email: "",
    phone: "",
    title: "",
    company: "",
  })

  const sources = useMemo(() => {
    const seen = new Set<string>()
    for (const item of items) seen.add(item.source)
    return [...seen].sort()
  }, [items])

  const filteredItems = useMemo(
    () => sourceFilter ? items.filter(item => item.source === sourceFilter) : items,
    [items, sourceFilter],
  )

  const selected = useMemo(
    () => filteredItems.find(item => item.id === selectedId) ?? filteredItems[0] ?? null,
    [filteredItems, selectedId],
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
    setShowCreatePerson(false)
    const parsedName = splitPersonName(selected.contactName)
    setNewPerson({
      first: parsedName.first,
      last: parsedName.last,
      email: selected.contactEmail ?? "",
      phone: selected.contactPhone ?? "",
      title: "",
      company: "",
    })
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

  async function createPersonFromSelected(acceptAfterCreate: boolean) {
    if (!selected) return
    if (!newPerson.first.trim() || !newPerson.last.trim()) {
      setError("Add a first and last name before creating the Person.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const createRes = await fetch("/api/persons", {
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
      const created = await createRes.json()
      if (!createRes.ok) throw new Error(created.error || "Could not create Person")

      const person: PersonRef = {
        id: created.id,
        first: created.first,
        last: created.last,
        title: created.title,
        company: created.company,
        emails: created.emails ?? [],
        phones: created.phones ?? [],
      }
      setSelectedPerson(person)

      if (!acceptAfterCreate) {
        setShowCreatePerson(false)
        await updateSelectedWithPerson(person)
        return
      }

      const acceptRes = await fetch(`/api/inbox/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "accept",
          personId: person.id,
          summary,
          direction: selected.direction,
        }),
      })
      const accepted = await acceptRes.json()
      if (!acceptRes.ok) throw new Error(accepted.error || "Could not accept item")
      removeItem(selected.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create Person")
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

  async function updateSelected(nextStatus?: "pending") {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/inbox/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          personId: selectedPerson?.id ?? selected.candidatePersonId,
          summary,
          direction: selected.direction,
          status: nextStatus,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not update item")
      setItems(prev => prev.map(item => item.id === selected.id
        ? {
          ...item,
          status: nextStatus ?? item.status,
          candidatePersonId: selectedPerson?.id ?? item.candidatePersonId,
          candidatePerson: selectedPerson ?? item.candidatePerson,
          summary,
        }
        : item))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update item")
    } finally {
      setSaving(false)
    }
  }

  async function updateSelectedWithPerson(person: PersonRef) {
    if (!selected) return
    const res = await fetch(`/api/inbox/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        personId: person.id,
        summary,
        direction: selected.direction,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Could not attach Person")
    setItems(prev => prev.map(item => item.id === selected.id
      ? {
        ...item,
        candidatePersonId: person.id,
        candidatePerson: person,
        summary,
      }
      : item))
  }

  async function applyRunSuggestions(ruleRunId: string) {
    if (!selected) return
    setApplying(ruleRunId)
    setError(null)
    try {
      const res = await fetch(`/api/inbox/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply_suggestions", ruleRunIds: [ruleRunId] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not apply suggestions")
      setItems(prev => prev.map(item =>
        item.id === selected.id
          ? {
            ...item,
            ruleRuns: item.ruleRuns.map(run =>
              run.id === ruleRunId
                ? { ...run, status: "applied", actionsApplied: run.actionsPlanned }
                : run
            ),
          }
          : item
      ))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply suggestions")
    } finally {
      setApplying(null)
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
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "10px" }}>
            <h1 style={{ margin: 0, fontSize: "18px", color: "var(--ink)", fontWeight: 600 }}>Inbox</h1>
            <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>{filteredItems.length} to review</span>
          </div>

          {sources.length > 1 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
              <button
                onClick={() => setSourceFilter(null)}
                style={filterPillStyle(sourceFilter === null)}
              >
                All
              </button>
              {sources.map(src => (
                <button
                  key={src}
                  onClick={() => setSourceFilter(src)}
                  style={filterPillStyle(sourceFilter === src)}
                >
                  {src}
                </button>
              ))}
            </div>
          )}

          {loading && <p style={{ fontSize: "12px", color: "var(--ink-3)" }}>Loading...</p>}
          {!loading && filteredItems.length === 0 && (
            <div style={{ padding: "32px 14px", color: "var(--ink-3)", fontSize: "12px", lineHeight: 1.5 }}>
              Nothing pending.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {filteredItems.map(item => {
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
                    {sources.length > 1 && <TinyPill tone="muted">{item.source}</TinyPill>}
                    {item.ruleRuns.some(run => run.matched) && <TinyPill tone="ok">rule matched</TinyPill>}
                    {item.ruleRuns.some(run => actionCount(run.actionsApplied) > 0) && <TinyPill tone="accent">auto updated</TinyPill>}
                    {item.ruleRuns.some(run => run.mode === "suggest" && run.matched && run.status === "suggested") && (
                      <TinyPill tone="suggest">suggestions pending</TinyPill>
                    )}
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
                    <div style={{ display: "flex", gap: "7px", alignItems: "center", color: "var(--ink-4)", fontSize: "11px", marginBottom: "4px" }}>
                      <span>{selected.source}</span>
                      {selected.status !== "pending" && <TinyPill tone={selected.status === "blocked" ? "warn" : "muted"}>{selected.status}</TinyPill>}
                    </div>
                    <h2 style={{ margin: 0, color: "var(--ink)", fontSize: "22px", fontWeight: 600 }}>
                      {selected.contactName || selected.contactEmail || selected.contactPhone || "Unknown person"}
                    </h2>
                  </div>
                  <div style={{ textAlign: "right", color: "var(--ink-3)", fontSize: "12px" }}>
                    <div>{formatDateTime(selected.timestamp)}</div>
                    <div>{selected.direction || "message"}</div>
                  </div>
                </div>

                {selected.status === "blocked" && (
                  <div style={{ border: "1px solid #d28a5d", background: "#fff4eb", color: "#914a22", borderRadius: "8px", padding: "10px 12px", fontSize: "12px", lineHeight: 1.45, marginBottom: "14px" }}>
                    A rule blocked this record. You can dismiss it, or return it to review after choosing the right Person.
                  </div>
                )}

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
                    {selected.ruleRuns.map(run => {
                      const canApply = run.mode === "suggest" && run.matched && run.status === "suggested" && actionCount(run.actionsPlanned) > 0
                      const isApplying = applying === run.id
                      return (
                        <div key={run.id} style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "10px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center" }}>
                            <div>
                              <div style={{ fontSize: "12px", color: "var(--ink)", fontWeight: 600 }}>{run.rule.name}</div>
                              <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "2px" }}>{run.trigger} · {run.mode} · {formatDateTime(run.createdAt)}</div>
                            </div>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                              {canApply && (
                                <button
                                  onClick={() => applyRunSuggestions(run.id)}
                                  disabled={isApplying}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: "6px",
                                    border: "1px solid var(--accent)",
                                    background: "var(--accent-soft)",
                                    color: "var(--accent)",
                                    font: "inherit",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    cursor: isApplying ? "not-allowed" : "pointer",
                                    opacity: isApplying ? 0.6 : 1,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {isApplying ? "Applying…" : "Apply"}
                                </button>
                              )}
                              <TinyPill tone={run.matched ? "ok" : "muted"}>{run.matched ? "matched" : "skipped"}</TinyPill>
                            </div>
                          </div>
                          {run.message && <div style={{ fontSize: "11px", color: "var(--ink-3)", marginTop: "8px" }}>{run.message}</div>}
                          {(actionCount(run.actionsPlanned) > 0 || actionCount(run.actionsApplied) > 0) && (
                            <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                              {actionCount(run.actionsPlanned) > 0 && run.status !== "applied" && (
                                <TinyPill tone="suggest">{actionCount(run.actionsPlanned)} suggested</TinyPill>
                              )}
                              {actionCount(run.actionsApplied) > 0 && <TinyPill tone="accent">{actionCount(run.actionsApplied)} applied</TinyPill>}
                            </div>
                          )}
                          {canApply && Array.isArray(run.actionsPlanned) && (
                            <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--ink-3)", lineHeight: 1.5 }}>
                              {(run.actionsPlanned as { type: string; field?: string; value?: unknown }[]).map((a, i) => (
                                <span key={i} style={{ display: "inline-block", marginRight: "8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "4px", padding: "2px 6px", fontFamily: "monospace", fontSize: "10px" }}>
                                  {a.type}{a.field ? ` ${a.field}` : ""}{a.value !== undefined ? `=${String(a.value)}` : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
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
                    <Link href={`/people/${selectedPerson.id}`} style={{ fontSize: "11px", color: "var(--accent)", textDecoration: "none" }}>
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

                <div style={{ marginTop: "14px", borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
                  <button
                    type="button"
                    onClick={() => setShowCreatePerson(open => !open)}
                    style={{ padding: "7px 11px", borderRadius: "6px", border: "1px solid var(--border)", background: showCreatePerson ? "var(--accent-soft)" : "transparent", color: showCreatePerson ? "var(--accent)" : "var(--ink-3)", font: "inherit", fontSize: "11px", cursor: "pointer" }}
                  >
                    + Create new Person
                  </button>

                  {showCreatePerson && (
                    <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <SmallField label="First" value={newPerson.first} onChange={value => setNewPerson(prev => ({ ...prev, first: value }))} />
                        <SmallField label="Last" value={newPerson.last} onChange={value => setNewPerson(prev => ({ ...prev, last: value }))} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <SmallField label="Email" value={newPerson.email} onChange={value => setNewPerson(prev => ({ ...prev, email: value }))} />
                        <SmallField label="Phone" value={newPerson.phone} onChange={value => setNewPerson(prev => ({ ...prev, phone: value }))} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <SmallField label="Title" value={newPerson.title} onChange={value => setNewPerson(prev => ({ ...prev, title: value }))} />
                        <SmallField label="Company" value={newPerson.company} onChange={value => setNewPerson(prev => ({ ...prev, company: value }))} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                        <button
                          onClick={() => createPersonFromSelected(false)}
                          disabled={saving}
                          style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", color: "var(--ink-3)", font: "inherit", fontSize: "11px", cursor: saving ? "not-allowed" : "pointer" }}
                        >
                          Create & Attach
                        </button>
                        <button
                          onClick={() => createPersonFromSelected(true)}
                          disabled={saving}
                          style={{ padding: "8px 12px", borderRadius: "6px", border: "none", background: "var(--accent)", color: "#fff", font: "inherit", fontSize: "11px", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}
                        >
                          Create & Accept
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {error && <p style={{ color: "var(--accent)", fontSize: "12px", margin: 0 }}>{error}</p>}

              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                <button
                  onClick={() => updateSelected()}
                  disabled={saving}
                  style={{ padding: "10px 16px", borderRadius: "7px", border: "1px solid var(--border)", background: "transparent", color: "var(--ink-3)", font: "inherit", fontSize: "12px", cursor: saving ? "not-allowed" : "pointer" }}
                >
                  Save Edits
                </button>
                {selected.status === "blocked" && (
                  <button
                    onClick={() => updateSelected("pending")}
                    disabled={saving}
                    style={{ padding: "10px 16px", borderRadius: "7px", border: "1px solid #d28a5d", background: "#fff4eb", color: "#914a22", font: "inherit", fontSize: "12px", cursor: saving ? "not-allowed" : "pointer" }}
                  >
                    Return to Review
                  </button>
                )}
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
                  Approve & Accept
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
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

function splitPersonName(value: string | null) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: "", last: "" }
  if (parts.length === 1) return { first: parts[0], last: "" }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

function SmallField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: "grid", gap: "5px", color: "var(--ink-4)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {label}
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: "7px", padding: "8px 9px", background: "var(--bg)", color: "var(--ink)", font: "inherit", fontSize: "12px", textTransform: "none", letterSpacing: 0 }}
      />
    </label>
  )
}

function TinyPill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" | "accent" | "suggest" }) {
  const styles = {
    muted: { border: "var(--border)", color: "var(--ink-4)", background: "var(--surface)" },
    ok: { border: "#88a06a", color: "#526b37", background: "#f3f7ee" },
    warn: { border: "#d28a5d", color: "#914a22", background: "#fff4eb" },
    accent: { border: "var(--accent)", color: "var(--accent)", background: "var(--accent-soft)" },
    suggest: { border: "#8a7abd", color: "#4a3a8a", background: "#f0eefb" },
  }[tone]
  return (
    <span style={{ display: "inline-flex", border: `1px solid ${styles.border}`, color: styles.color, background: styles.background, borderRadius: "999px", padding: "2px 7px", fontSize: "10px", lineHeight: 1.3 }}>
      {children}
    </span>
  )
}
