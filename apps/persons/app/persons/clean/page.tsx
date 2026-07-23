"use client"

import type React from "react"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import EditPersonModal from "@/components/persons/EditPersonModal"
import PersonAvatar from "@/components/persons/PersonAvatar"
import type { Person } from "@/types"

type IssueKey =
  | "all"
  | "all_people"
  | "missing_email"
  | "missing_phone"
  | "missing_first"
  | "missing_last"
  | "name_only"
  | "strange_symbols"

type SortKey = "issues" | "sparse" | "name" | "recent"

type CleanupPerson = Person & {
  interactionCount: number
  issueKeys: Exclude<IssueKey, "all">[]
  issueLabels: string[]
  completenessScore: number
}

type CleanupStats = {
  total: number
  needsCleanup: number
  missingEmail: number
  missingPhone: number
  missingFirst: number
  missingLast: number
  nameOnly: number
  strangeSymbols: number
}

type StatAction = {
  issue: IssueKey
  sort: SortKey
}

type StatCard = StatAction & {
  label: string
  value: number
  tone?: "accent"
}

const ISSUE_FILTERS: { key: IssueKey; label: string }[] = [
  { key: "all", label: "All issues" },
  { key: "missing_email", label: "No email" },
  { key: "missing_phone", label: "No phone" },
  { key: "name_only", label: "Name only" },
  { key: "missing_first", label: "No first" },
  { key: "missing_last", label: "No last" },
  { key: "strange_symbols", label: "Symbols" },
]

const SORTS: { key: SortKey; label: string }[] = [
  { key: "issues", label: "Most issues" },
  { key: "sparse", label: "Least data" },
  { key: "name", label: "Name" },
  { key: "recent", label: "Recently updated" },
]

export default function DataCleaningPage() {
  const [people, setPeople] = useState<CleanupPerson[]>([])
  const [stats, setStats] = useState<CleanupStats | null>(null)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState("")
  const [issue, setIssue] = useState<IssueKey>("all")
  const [sort, setSort] = useState<SortKey>("issues")
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<CleanupPerson | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPeople = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        issue,
        sort,
        limit: "200",
        ...(search.trim() ? { search: search.trim() } : {}),
      })
      const res = await fetch(`/api/persons/data-cleaning?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not load data cleaning view")
      setPeople(data.people ?? [])
      setStats(data.stats ?? null)
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load data cleaning view")
    } finally {
      setLoading(false)
    }
  }, [issue, search, sort])

  useEffect(() => {
    const timer = setTimeout(loadPeople, 180)
    return () => clearTimeout(timer)
  }, [loadPeople])

  async function deletePerson(person: CleanupPerson) {
    if (!confirm(`Delete ${displayName(person)}?`)) return
    setSavingId(person.id)
    setError(null)
    try {
      const res = await fetch(`/api/persons/${person.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not delete person")
      await loadPeople()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete person")
    } finally {
      setSavingId(null)
    }
  }

  function applyStat(action: StatAction) {
    setIssue(action.issue)
    setSort(action.sort)
  }

  const statCards: StatCard[] = stats
    ? [
        { label: "Total people", value: stats.total, issue: "all_people", sort: "name" },
        { label: "Need cleanup", value: stats.needsCleanup, issue: "all", sort: "issues", tone: "accent" },
        { label: "No phone", value: stats.missingPhone, issue: "missing_phone", sort: "sparse" },
        { label: "No email", value: stats.missingEmail, issue: "missing_email", sort: "sparse" },
        { label: "Name only", value: stats.nameOnly, issue: "name_only", sort: "name" },
        { label: "Symbols", value: stats.strangeSymbols, issue: "strange_symbols", sort: "name" },
      ]
    : []

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "22px" }}>
        <div>
          <Link href="/persons" style={{ color: "var(--ink-4)", fontSize: "11px", textDecoration: "none" }}>← Persons</Link>
          <h1 style={{ fontFamily: "var(--font-display), serif", fontSize: "28px", fontWeight: 600, color: "var(--ink)", margin: "6px 0 0" }}>
            Data Cleaning
            {stats && <span style={{ fontSize: "14px", fontWeight: 400, color: "var(--ink-4)", marginLeft: "10px" }}>{stats.needsCleanup.toLocaleString()}</span>}
          </h1>
        </div>
        <Link href="/persons/merge" style={{ padding: "9px 16px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "7px", fontFamily: "inherit", fontSize: "12px", textDecoration: "none" }}>
          ⇄ Dedupe
        </Link>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(126px, 1fr))", gap: "8px", marginBottom: "14px" }}>
          {statCards.map(card => (
            <Stat
              key={card.label}
              label={card.label}
              value={card.value}
              tone={card.tone}
              active={issue === card.issue && sort === card.sort}
              onClick={() => applyStat(card)}
            />
          ))}
        </div>
      )}

      <div style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "8px", padding: "14px", marginBottom: "14px" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search cleanup list by name, issue, email, phone, company…"
          style={{ width: "100%", boxSizing: "border-box", marginBottom: "12px", padding: "10px 12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "7px", color: "var(--ink)", font: "inherit", fontSize: "12px" }}
        />
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "10px" }}>
          <span style={{ fontSize: "10px", color: "var(--ink-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Filter:</span>
          {issue === "all_people" && (
            <button onClick={() => setIssue("all_people")} style={pillStyle(true)}>
              All people
            </button>
          )}
          {ISSUE_FILTERS.map(filter => (
            <button key={filter.key} onClick={() => setIssue(filter.key)} style={pillStyle(issue === filter.key)}>
              {filter.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "10px", color: "var(--ink-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Sort:</span>
          {SORTS.map(option => (
            <button key={option.key} onClick={() => setSort(option.key)} style={pillStyle(sort === option.key)}>
              {option.label}
            </button>
          ))}
          <span style={{ marginLeft: "auto", color: "var(--ink-4)", fontSize: "11px" }}>{total.toLocaleString()} shown</span>
        </div>
      </div>

      {error && <p style={{ margin: "0 0 12px", color: "var(--accent)", fontSize: "12px" }}>{error}</p>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "44px", color: "var(--ink-4)", fontSize: "12px" }}>Loading…</div>
      ) : people.length === 0 ? (
        <div style={{ textAlign: "center", padding: "44px", color: "var(--ink-4)", fontSize: "12px" }}>No people match this cleanup view.</div>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {people.map(person => (
            <div key={person.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "12px", alignItems: "center", border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "8px", padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: "12px", minWidth: 0, alignItems: "center" }}>
                <PersonAvatar first={person.first} last={person.last} color={person.color} colorSoft={person.colorSoft} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                    <Link href={`/persons/${person.id}`} style={{ color: "var(--ink)", fontWeight: 600, fontSize: "13px", textDecoration: "none" }}>
                      {displayName(person)}
                    </Link>
                    {person.nickname && <span style={{ color: "var(--ink-4)", fontSize: "11px" }}>aka {person.nickname}</span>}
                  </div>
                  <div style={{ marginTop: "3px", color: "var(--ink-3)", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[person.title, person.company, person.emails[0], person.phones[0]].filter(Boolean).join(" · ") || "No details yet"}
                  </div>
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "7px" }}>
                    {person.issueLabels.map(label => <TinyPill key={label}>{label}</TinyPill>)}
                    <TinyPill muted>{person.interactionCount} interactions</TinyPill>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => setEditing(person)} style={actionButtonStyle}>Edit</button>
                <button onClick={() => deletePerson(person)} disabled={savingId === person.id} style={{ ...actionButtonStyle, color: "var(--accent)" }}>
                  {savingId === person.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditPersonModal
          person={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadPeople() }}
        />
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  tone?: "accent"
  active: boolean
  onClick: () => void
}) {
  const accent = tone === "accent" || active
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: accent ? "var(--accent-soft)" : "var(--surface)",
        borderRadius: "8px",
        padding: "12px",
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        boxShadow: active ? "0 0 0 1px var(--accent)" : "none",
      }}
    >
      <div style={{ color: accent ? "var(--accent)" : "var(--ink)", fontSize: "20px", fontWeight: 600 }}>{value.toLocaleString()}</div>
      <div style={{ color: "var(--ink-4)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "3px" }}>{label}</div>
    </button>
  )
}

function TinyPill({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span style={{ border: "1px solid var(--border)", background: muted ? "var(--surface2)" : "var(--accent-soft)", color: muted ? "var(--ink-4)" : "var(--accent)", borderRadius: "999px", padding: "2px 7px", fontSize: "10px", lineHeight: 1.3 }}>
      {children}
    </span>
  )
}

function displayName(person: Person) {
  return `${person.first || "Missing first"} ${person.last || "Missing last"}`.trim()
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: "999px",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--accent)" : "var(--ink-3)",
    cursor: "pointer",
    font: "inherit",
    fontSize: "11px",
  }
}

const actionButtonStyle: React.CSSProperties = {
  padding: "7px 11px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--ink-3)",
  cursor: "pointer",
  font: "inherit",
  fontSize: "11px",
}
