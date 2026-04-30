"use client"

import React, { useState, useEffect, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { BackLink, Button, Spinner } from "@life-os/ui"
import type { Person } from "@/types"
import type { DupePair } from "@/lib/dedupe"

type Choice = "a" | "b" | "both"

const FIELDS: { key: keyof Person; label: string; multiline?: boolean }[] = [
  { key: "first",    label: "First name" },
  { key: "last",     label: "Last name" },
  { key: "headline", label: "Headline" },
  { key: "company",  label: "Company" },
  { key: "location", label: "Location" },
  { key: "birthday", label: "Birthday" },
  { key: "closeness",label: "Closeness" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "twitter",  label: "Twitter" },
  { key: "website",  label: "Website" },
  { key: "notes",    label: "Notes", multiline: true },
]

function pairKey(p: DupePair) {
  return `${p.a.id}-${p.b.id}`
}

function initChoices(a: Person, b: Person): Record<string, Choice> {
  const out: Record<string, Choice> = {}
  for (const { key } of FIELDS) {
    const av = a[key as keyof Person]
    const bv = b[key as keyof Person]
    if (key === "notes" && av && bv) {
      out[key] = "both"
    } else if (av && !bv) {
      out[key] = "a"
    } else if (!av && bv) {
      out[key] = "b"
    } else if (key === "closeness") {
      out[key] = (a.closeness >= b.closeness) ? "a" : "b"
    } else if (typeof av === "string" && typeof bv === "string") {
      out[key] = av.length >= bv.length ? "a" : "b"
    } else {
      out[key] = "a"
    }
  }
  return out
}

function buildFields(a: Person, b: Person, choices: Record<string, Choice>) {
  const fields: Record<string, unknown> = {}
  for (const { key } of FIELDS) {
    const av = a[key as keyof Person]
    const bv = b[key as keyof Person]
    const c = choices[key] ?? "a"
    if (key === "notes" && c === "both") {
      fields[key] = [av, bv].filter(Boolean).join("\n\n---\n\n")
    } else {
      fields[key] = c === "a" ? av : bv
    }
  }
  const aTags = Array.isArray(a.tags) ? a.tags : []
  const bTags = Array.isArray(b.tags) ? b.tags : []
  fields.tags = [...new Set([...aTags, ...bTags])]
  const aVals = Array.isArray(a.values) ? a.values : []
  const bVals = Array.isArray(b.values) ? b.values : []
  fields.values = [...new Set([...aVals, ...bVals])]
  const aEmails = Array.isArray(a.emails) ? a.emails : []
  const bEmails = Array.isArray(b.emails) ? b.emails : []
  fields.emails = [...new Set([...aEmails, ...bEmails])]
  const aPhones = Array.isArray(a.phones) ? a.phones : []
  const bPhones = Array.isArray(b.phones) ? b.phones : []
  fields.phones = [...new Set([...aPhones, ...bPhones])]
  return fields
}

function scoreColor(s: number) {
  if (s >= 0.95) return "#c4572a"
  if (s >= 0.87) return "#b45309"
  return "#7c6d00"
}

function scoreBg(s: number) {
  if (s >= 0.95) return "#fdf0eb"
  if (s >= 0.87) return "#fef3c7"
  return "#fefce8"
}

type AutoDedupeResult = { keepId: string; deleteId: string; score: number; reason: string; keepName: string; deleteName: string }
type AutoDedupeState = { status: "idle" | "confirm" | "running" | "done" | "error"; merged: number; results: AutoDedupeResult[]; error?: string }

export default function MergeDuplicatesUI({ initialPairs }: { initialPairs: DupePair[] }) {
  const router = useRouter()
  const [pairs, setPairs]         = useState<DupePair[]>(initialPairs)
  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialPairs.length > 0 ? pairKey(initialPairs[0]) : null
  )
  const [choices, setChoices]     = useState<Record<string, Choice>>(
    initialPairs.length > 0 ? initChoices(initialPairs[0].a, initialPairs[0].b) : {}
  )
  const [search, setSearch]       = useState("")
  const [swapped, setSwapped]     = useState(false)
  const [merging, setMerging]     = useState(false)
  const [autoDedupe, setAutoDedupe] = useState<AutoDedupeState>({ status: "idle", merged: 0, results: [] })
  const [reviewedCount, setReviewedCount] = useState(0)
  const [mergingEmail, setMergingEmail] = useState(false)

  // Sync when server re-renders with new data after router.refresh()
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!initializedRef.current) { initializedRef.current = true; return }
    setPairs(initialPairs)
    const first = initialPairs[0] ?? null
    setSelectedKey(first ? pairKey(first) : null)
    setChoices(first ? initChoices(first.a, first.b) : {})
    setSwapped(false)
  }, [initialPairs])

  const stats = useMemo(() => {
    const definite  = pairs.filter(p => p.score >= 1.0).length    // same email
    const high      = pairs.filter(p => p.score >= 0.95 && p.score < 1.0).length  // same phone / very similar
    const medium    = pairs.filter(p => p.score >= 0.87 && p.score < 0.95).length
    const lower     = pairs.filter(p => p.score < 0.87).length
    const byReason  = pairs.reduce<Record<string, number>>((acc, p) => {
      acc[p.reason] = (acc[p.reason] ?? 0) + 1
      return acc
    }, {})
    return { definite, high, medium, lower, byReason }
  }, [pairs])

  const filteredPairs = useMemo(() => {
    if (!search.trim()) return pairs
    const q = search.toLowerCase()
    return pairs.filter(p =>
      `${p.a.first} ${p.a.last}`.toLowerCase().includes(q) ||
      `${p.b.first} ${p.b.last}`.toLowerCase().includes(q)
    )
  }, [pairs, search])

  const personPairCount = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of pairs) {
      counts[p.a.id] = (counts[p.a.id] || 0) + 1
      counts[p.b.id] = (counts[p.b.id] || 0) + 1
    }
    return counts
  }, [pairs])

  function selectPair(p: DupePair) {
    setSelectedKey(pairKey(p))
    setSwapped(false)
    setChoices(initChoices(p.a, p.b))
  }

  function swap() {
    setSwapped(s => !s)
    setChoices(prev => {
      const next: Record<string, Choice> = {}
      for (const [k, v] of Object.entries(prev)) {
        next[k] = v === "a" ? "b" : v === "b" ? "a" : v
      }
      return next
    })
  }

  function setChoice(key: string, side: "a" | "b") {
    setChoices(prev => {
      const cur = prev[key]
      if (key === "notes") {
        if (cur === "both") return { ...prev, [key]: side }
        if (cur !== side)   return { ...prev, [key]: "both" }
      }
      return { ...prev, [key]: side }
    })
  }

  async function handleMerge() {
    if (!pair || !a || !b) return
    const deletedId = b.id
    const currentKey = selectedKey
    setMerging(true)
    const res = await fetch("/api/contacts/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepId: a.id, deleteId: b.id, fields: buildFields(a, b, choices) }),
    })
    if (res.ok) {
      const remaining = pairs.filter(p =>
        pairKey(p) !== currentKey && p.a.id !== deletedId && p.b.id !== deletedId
      )
      setPairs(remaining)
      setReviewedCount(c => c + 1)
      const next = remaining[0] ?? null
      setSelectedKey(next ? pairKey(next) : null)
      setSwapped(false)
      if (next) setChoices(initChoices(next.a, next.b))
    }
    setMerging(false)
  }

  function skipPair() {
    const remaining = pairs.filter(p => pairKey(p) !== selectedKey)
    setPairs(remaining)
    setReviewedCount(c => c + 1)
    const next = remaining[0] ?? null
    setSelectedKey(next ? pairKey(next) : null)
    setSwapped(false)
    if (next) setChoices(initChoices(next.a, next.b))
  }

  async function runAutoDedupe() {
    setAutoDedupe({ status: "running", merged: 0, results: [] })
    try {
      const res = await fetch("/api/contacts/auto-dedupe", { method: "POST" })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setAutoDedupe({ status: "done", merged: data.merged, results: data.results })
      if (data.merged > 0) router.refresh()
    } catch (e) {
      setAutoDedupe({ status: "error", merged: 0, results: [], error: String(e) })
    }
  }

  async function mergeAllSameEmail() {
    const emailPairs = pairs.filter(p => p.reason === "Same email address")
    if (emailPairs.length === 0) return
    setMergingEmail(true)
    try {
      // Pick keeper by interaction count, fall back to the one listed as `a`
      const pairInputs = emailPairs.map(p => {
        const keepId = p.a.interactionCount >= p.b.interactionCount ? p.a.id : p.b.id
        const deleteId = keepId === p.a.id ? p.b.id : p.a.id
        return { keepId, deleteId }
      })
      const res = await fetch("/api/contacts/merge-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs: pairInputs }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      const deletedIds = new Set<string>(data.deletedIds ?? [])
      const remaining = pairs.filter(p => !deletedIds.has(p.a.id) && !deletedIds.has(p.b.id))
      setPairs(remaining)
      setReviewedCount(c => c + data.merged)
      const next = remaining[0] ?? null
      setSelectedKey(next ? pairKey(next) : null)
      setSwapped(false)
      if (next) setChoices(initChoices(next.a, next.b))
    } catch (e) {
      console.error("merge-all-email failed", e)
    }
    setMergingEmail(false)
  }

  const pair = selectedKey ? pairs.find(p => pairKey(p) === selectedKey) ?? null : null
  const a    = pair ? (swapped ? pair.b : pair.a) : null
  const b    = pair ? (swapped ? pair.a : pair.b) : null

  return (
    <div style={{ maxWidth: "1020px", margin: "0 auto", padding: "32px 24px" }}>

      <BackLink label="Contacts" href="/contacts" component={Link} style={{ marginBottom: "16px" }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: pairs.length > 0 ? "14px" : "24px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 600, color: "var(--ink)", margin: 0 }}>
          Merge Duplicates
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAutoDedupe(s => s.status === "confirm" ? { ...s, status: "idle" } : { ...s, status: "confirm" })}
          style={{ borderRadius: "7px", textTransform: "none", letterSpacing: 0 }}
        >
          ⚡ Auto-dedupe
        </Button>
      </div>

      {/* Stats strip */}
      {pairs.length > 0 && (
        <div style={{
          display: "flex",
          gap: "0",
          marginBottom: "24px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          overflow: "hidden",
        }}>
          <StatCell label="Remaining" value={String(pairs.length)} accent />
          {reviewedCount > 0 && <StatCell label="Done this session" value={String(reviewedCount)} />}
          {stats.definite > 0 && (
            <StatCell
              label="Same email"
              value={String(stats.definite)}
              dot="#c4572a"
              action={
                <button
                  onClick={mergeAllSameEmail}
                  disabled={mergingEmail}
                  style={{ marginTop: "6px", fontSize: "9px", fontFamily: "inherit", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "4px", padding: "3px 7px", cursor: mergingEmail ? "wait" : "pointer", opacity: mergingEmail ? 0.6 : 1, letterSpacing: "0.04em" }}
                >
                  {mergingEmail ? "merging…" : "merge all"}
                </button>
              }
            />
          )}
          {stats.high > 0 && <StatCell label="Very similar" value={String(stats.high)} dot="#b45309" />}
          {stats.medium > 0 && <StatCell label="Similar name" value={String(stats.medium)} dot="#7c6d00" />}
          {stats.lower > 0 && <StatCell label="Needs review" value={String(stats.lower)} dot="var(--ink-4)" />}
        </div>
      )}

      {/* Auto-dedupe panel */}
      {autoDedupe.status === "confirm" && (
        <div style={{ marginBottom: "20px", padding: "16px 18px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--ink)", marginBottom: "6px" }}>Auto-merge high-confidence duplicates?</div>
          <div style={{ fontSize: "12px", color: "var(--ink-3)", marginBottom: "14px" }}>
            Scans all contacts and automatically merges pairs with ≥93% similarity (exact email, exact phone, or very similar names). The contact with more interactions is kept; data is merged, never lost.
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="primary" size="sm" onClick={runAutoDedupe} style={{ borderRadius: "7px", textTransform: "none", letterSpacing: 0 }}>
              Run auto-dedupe
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAutoDedupe(s => ({ ...s, status: "idle" }))} style={{ borderRadius: "7px", textTransform: "none", letterSpacing: 0 }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {autoDedupe.status === "running" && (
        <div style={{ marginBottom: "20px", padding: "16px 18px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", display: "flex", alignItems: "center", gap: "12px" }}>
          <Spinner size={14} color="var(--accent)" />
          <span style={{ fontSize: "12px", color: "var(--ink-3)" }}>Scanning all contacts… this may take a moment.</span>
        </div>
      )}

      {autoDedupe.status === "error" && (
        <div style={{ marginBottom: "20px", padding: "14px 18px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", fontSize: "12px", color: "#b91c1c", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Auto-dedupe failed: {autoDedupe.error}</span>
          <button onClick={() => setAutoDedupe(s => ({ ...s, status: "idle" }))} style={{ fontSize: "11px", color: "#b91c1c", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", flexShrink: 0, marginLeft: "12px" }}>dismiss</button>
        </div>
      )}

      {autoDedupe.status === "done" && (
        <div style={{ marginBottom: "20px", padding: "16px 18px", background: autoDedupe.merged > 0 ? "#f0fdf4" : "var(--surface)", border: `1px solid ${autoDedupe.merged > 0 ? "#bbf7d0" : "var(--border)"}`, borderRadius: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: autoDedupe.merged > 0 ? "#16a34a" : "var(--ink)", marginBottom: autoDedupe.merged > 0 ? "10px" : 0 }}>
                {autoDedupe.merged > 0 ? `✓ Merged ${autoDedupe.merged} duplicate${autoDedupe.merged === 1 ? "" : "s"}` : "✓ No high-confidence duplicates found"}
              </div>
              {autoDedupe.results.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {autoDedupe.results.map((r, i) => (
                    <div key={i} style={{ fontSize: "11px", color: "#166534", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ color: "#16a34a" }}>→</span>
                      <span style={{ fontWeight: 500 }}>{r.keepName}</span>
                      <span style={{ color: "#4ade80" }}>absorbed</span>
                      <span>{r.deleteName}</span>
                      <span style={{ color: "#86efac", fontSize: "10px" }}>({r.reason}, {Math.round(r.score * 100)}%)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setAutoDedupe(s => ({ ...s, status: "idle" }))} style={{ fontSize: "11px", color: "var(--ink-4)", background: "transparent", border: "none", cursor: "pointer", flexShrink: 0, marginLeft: "12px" }}>✕</button>
          </div>
        </div>
      )}

      {pairs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 32px", border: "1px solid var(--border)", borderRadius: "14px", background: "var(--surface)" }}>
          <div style={{ fontSize: "28px", marginBottom: "10px" }}>✓</div>
          <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--ink)", marginBottom: "6px" }}>All clean</div>
          <div style={{ fontSize: "12px", color: "var(--ink-4)" }}>No potential duplicates found.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "14px", alignItems: "start" }}>

          {/* ── Pair list ─────────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <div style={{ position: "relative", marginBottom: "2px" }}>
              <input
                type="text"
                placeholder="Search by name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 28px 7px 10px",
                  fontSize: "12px",
                  fontFamily: "inherit",
                  color: "var(--ink)",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  style={{ position: "absolute", right: "7px", top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-4)", fontSize: "12px", padding: 0, lineHeight: 1 }}
                >
                  ✕
                </button>
              )}
            </div>

            {search.trim() && (
              <div style={{ fontSize: "10px", color: "var(--ink-4)", padding: "0 2px 2px" }}>
                {filteredPairs.length} of {pairs.length} pair{pairs.length === 1 ? "" : "s"}
              </div>
            )}

            {filteredPairs.length === 0 && search.trim() ? (
              <div style={{ padding: "20px 12px", textAlign: "center", fontSize: "11px", color: "var(--ink-4)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }}>
                No pairs match "{search}"
              </div>
            ) : (
              filteredPairs.map((p) => {
                const key = pairKey(p)
                const active = selectedKey === key
                const aCount = personPairCount[p.a.id] ?? 0
                const bCount = personPairCount[p.b.id] ?? 0
                return (
                  <button
                    key={key}
                    onClick={() => selectPair(p)}
                    style={{
                      textAlign: "left",
                      padding: "11px 13px",
                      background: active ? "var(--accent-soft)" : "var(--surface)",
                      border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                      borderRadius: "10px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: "all 0.1s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--ink)" }}>
                        {p.a.first} {p.a.last}
                        {aCount > 1 && <span style={{ fontSize: "9px", fontWeight: 400, color: "var(--ink-4)", marginLeft: "5px" }}>{aCount} pairs</span>}
                      </span>
                      <span style={{ fontSize: "10px", fontWeight: 600, color: scoreColor(p.score), background: scoreBg(p.score), padding: "2px 7px", borderRadius: "20px", flexShrink: 0, marginLeft: "6px" }}>
                        {Math.round(p.score * 100)}%
                      </span>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--ink-3)", marginBottom: "3px" }}>
                      {p.b.first} {p.b.last}
                      {bCount > 1 && <span style={{ fontSize: "9px", color: "var(--ink-4)", marginLeft: "5px" }}>{bCount} pairs</span>}
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--ink-4)" }}>{p.reason}</div>
                  </button>
                )
              })
            )}
          </div>

          {/* ── Merge panel ───────────────────────────────────────── */}
          {pair && a && b && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ padding: "13px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>
                  <span style={{ color: "var(--accent)", fontWeight: 500 }}>A</span> is kept &nbsp;·&nbsp; <span style={{ color: "var(--ink-3)" }}>B</span> is deleted &nbsp;·&nbsp; click a value to select it
                </span>
                <button
                  onClick={swap}
                  style={{ fontSize: "11px", color: "var(--ink-3)", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}
                >
                  ⇄ Swap A &amp; B
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "108px 1fr 1fr", padding: "9px 18px", background: "var(--bg)", borderBottom: "1px solid var(--border)", gap: "10px" }}>
                <div style={{ fontSize: "10px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Field</div>
                <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--ink)" }}>
                  {a.first} {a.last}
                  <span style={{ fontSize: "10px", fontWeight: 400, color: "var(--accent)", marginLeft: "5px" }}>A (kept)</span>
                </div>
                <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--ink)" }}>
                  {b.first} {b.last}
                  <span style={{ fontSize: "10px", fontWeight: 400, color: "var(--ink-4)", marginLeft: "5px" }}>B (deleted)</span>
                </div>
              </div>

              <div style={{ maxHeight: "420px", overflowY: "auto" }}>
                {FIELDS.map(({ key, label, multiline }) => {
                  const av = a[key as keyof Person]
                  const bv = b[key as keyof Person]
                  const aStr = av != null && av !== "" ? String(av) : ""
                  const bStr = bv != null && bv !== "" ? String(bv) : ""
                  if (!aStr && !bStr) return null

                  const choice = choices[key] ?? "a"
                  const aActive = choice === "a" || choice === "both"
                  const bActive = choice === "b" || choice === "both"

                  const cellStyle = (active: boolean, hasVal: boolean): React.CSSProperties => ({
                    textAlign: "left",
                    padding: "6px 10px",
                    borderRadius: "7px",
                    border: `1.5px solid ${active && hasVal ? "var(--accent)" : "var(--border)"}`,
                    background: active && hasVal ? "var(--accent-soft)" : "transparent",
                    color: hasVal ? (active ? "var(--accent)" : "var(--ink)") : "var(--ink-4)",
                    fontSize: "12px",
                    fontFamily: "inherit",
                    cursor: hasVal ? "pointer" : "default",
                    opacity: !hasVal ? 0.35 : 1,
                    transition: "all 0.1s",
                    whiteSpace: multiline ? "pre-wrap" : "nowrap",
                    overflow: multiline ? "visible" : "hidden",
                    textOverflow: multiline ? "unset" : "ellipsis",
                    wordBreak: multiline ? "break-word" : "normal",
                    maxWidth: "100%",
                    display: "block",
                  })

                  return (
                    <div
                      key={key}
                      style={{ display: "grid", gridTemplateColumns: "108px 1fr 1fr", padding: "7px 18px", borderBottom: "1px solid var(--border)", gap: "10px", alignItems: multiline ? "flex-start" : "center" }}
                    >
                      <div style={{ fontSize: "10px", color: "var(--ink-4)", paddingTop: multiline ? "8px" : 0 }}>
                        {label}
                        {key === "notes" && aStr && bStr && (
                          <div style={{ fontSize: "9px", color: "var(--ink-4)", marginTop: "2px", fontStyle: "italic" }}>
                            {choice === "both" ? "merging both" : "click both to merge"}
                          </div>
                        )}
                      </div>
                      <button onClick={() => aStr ? setChoice(key, "a") : undefined} disabled={!aStr} style={cellStyle(aActive, !!aStr)}>
                        {aStr || "—"}
                      </button>
                      <button onClick={() => bStr ? setChoice(key, "b") : undefined} disabled={!bStr} style={cellStyle(bActive, !!bStr)}>
                        {bStr || "—"}
                      </button>
                    </div>
                  )
                })}

                {/* Array fields — always union-merged */}
                {(["emails", "phones", "tags", "values"] as const).map(field => {
                  const aArr = Array.isArray(a[field]) ? a[field] as unknown as string[] : []
                  const bArr = Array.isArray(b[field]) ? b[field] as unknown as string[] : []
                  const merged = [...new Set([...aArr, ...bArr])]
                  if (merged.length === 0) return null
                  return (
                    <div key={field} style={{ display: "grid", gridTemplateColumns: "108px 1fr", padding: "8px 18px", borderBottom: "1px solid var(--border)", gap: "10px", alignItems: "flex-start" }}>
                      <div style={{ fontSize: "10px", color: "var(--ink-4)", paddingTop: "5px", textTransform: "capitalize" }}>{field}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
                        {merged.map(v => (
                          <span key={v} style={{ padding: "2px 8px", borderRadius: "20px", background: "var(--surface2)", color: "var(--ink-2)", fontSize: "11px", border: "1px solid var(--border)" }}>
                            {v}
                          </span>
                        ))}
                        <span style={{ fontSize: "10px", color: "var(--ink-4)", marginLeft: "2px" }}>merged</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={{ padding: "9px 18px", background: "var(--bg)", borderTop: "1px solid var(--border)", fontSize: "11px", color: "var(--ink-4)" }}>
                {a.interactionCount + b.interactionCount} interaction{a.interactionCount + b.interactionCount !== 1 ? "s" : ""} · {a.planCount + b.planCount} plan{a.planCount + b.planCount !== 1 ? "s" : ""} → all kept under {a.first} {a.last}
              </div>

              <div style={{ padding: "14px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <Button variant="ghost" size="sm" onClick={skipPair} style={{ borderRadius: "8px", textTransform: "none", letterSpacing: 0 }}>
                  Not a duplicate
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleMerge}
                  disabled={merging}
                  style={{ borderRadius: "8px", textTransform: "none", letterSpacing: 0, opacity: merging ? 0.7 : 1 }}
                >
                  {merging ? "Merging…" : `Merge → Keep ${a.first} ${a.last}`}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCell({ label, value, accent, dot, action }: { label: string; value: string; accent?: boolean; dot?: string; action?: React.ReactNode }) {
  return (
    <div style={{
      flex: "1 1 0",
      padding: "12px 16px",
      borderRight: "1px solid var(--border)",
      minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "3px" }}>
        {dot && <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: dot, flexShrink: 0, display: "inline-block" }} />}
        <span style={{ fontSize: "9px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: "20px", fontWeight: 600, fontFamily: "var(--font-display)", color: accent ? "var(--accent)" : "var(--ink)", lineHeight: 1 }}>
        {value}
      </div>
      {action}
    </div>
  )
}
