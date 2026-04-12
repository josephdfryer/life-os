"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import PersonCard from "@/components/persons/PersonCard"
import AddPersonModal from "@/components/persons/AddPersonModal"
import type { PersonWithAttention } from "@/types"

type SortKey = "attention" | "lastContact" | "closeness" | "name"

export default function ContactsPage() {
  const [persons, setPersons] = useState<PersonWithAttention[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [sort, setSort] = useState<SortKey>("attention")
  const [showAdd, setShowAdd] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/persons")
    if (res.ok) {
      const data: PersonWithAttention[] = await res.json()
      setPersons(data)
      // Collect all unique tags
      const tags = new Set<string>()
      data.forEach(p => {
        const t = Array.isArray(p.tags) ? p.tags : []
        t.forEach((tag: string) => tags.add(tag))
      })
      setAllTags(Array.from(tags).sort())
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function toggleTag(tag: string) {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }

  const filtered = persons
    .filter(p => {
      const q = search.toLowerCase()
      const tags = Array.isArray(p.tags) ? p.tags : []
      if (q) {
        const matches =
          `${p.first} ${p.last}`.toLowerCase().includes(q) ||
          (p.headline ?? "").toLowerCase().includes(q) ||
          tags.some((t: string) => t.toLowerCase().includes(q)) ||
          (p.notes ?? "").toLowerCase().includes(q)
        if (!matches) return false
      }
      if (selectedTags.length) {
        const hasAll = selectedTags.every(st => tags.includes(st))
        if (!hasAll) return false
      }
      return true
    })
    .sort((a, b) => {
      if (sort === "attention") return b.attentionScore - a.attentionScore
      if (sort === "lastContact") {
        const aT = a.lastInteractionDate?.getTime() ?? 0
        const bT = b.lastInteractionDate?.getTime() ?? 0
        return bT - aT
      }
      if (sort === "closeness") return b.closeness - a.closeness
      if (sort === "name") return `${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`)
      return 0
    })

  return (
    <div style={{ maxWidth: "760px", margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "28px", fontWeight: 600, color: "var(--ink)", margin: 0 }}>
          Contacts
          <span style={{ fontSize: "14px", fontWeight: 400, color: "var(--ink-4)", marginLeft: "10px" }}>
            {persons.length}
          </span>
        </h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <Link
            href="/contacts/merge"
            style={{
              padding: "9px 16px",
              background: "transparent",
              color: "var(--ink-3)",
              border: "1px solid var(--border)",
              borderRadius: "7px",
              fontFamily: "inherit",
              fontSize: "12px",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            ⇄ Dedupe
          </Link>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              padding: "9px 18px",
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: "7px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "12px",
              fontWeight: 500,
            }}
          >
            + Add Person
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: "12px" }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, headline, tag, notes…"
          style={{
            width: "100%",
            padding: "10px 14px 10px 36px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--ink)",
            fontFamily: "inherit",
            fontSize: "12px",
          }}
        />
        <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: "13px" }}>⊕</span>
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "16px" }}>
          {allTags.map(tag => {
            const active = selectedTags.includes(tag)
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                style={{
                  padding: "4px 11px",
                  borderRadius: "20px",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  background: active ? "var(--accent-soft)" : "var(--surface)",
                  color: active ? "var(--accent)" : "var(--ink-3)",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {tag}
              </button>
            )
          })}
          {selectedTags.length > 0 && (
            <button
              onClick={() => setSelectedTags([])}
              style={{
                padding: "4px 11px",
                borderRadius: "20px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--ink-4)",
                fontSize: "11px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Sort */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", alignItems: "center" }}>
        <span style={{ fontSize: "10px", color: "var(--ink-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Sort:</span>
        {(["attention", "lastContact", "closeness", "name"] as SortKey[]).map(s => (
          <button
            key={s}
            onClick={() => setSort(s)}
            style={{
              padding: "4px 11px",
              borderRadius: "6px",
              border: `1px solid ${sort === s ? "var(--accent)" : "var(--border)"}`,
              background: sort === s ? "var(--accent-soft)" : "transparent",
              color: sort === s ? "var(--accent)" : "var(--ink-3)",
              fontSize: "11px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {s === "attention" ? "Attention" : s === "lastContact" ? "Last Contact" : s === "closeness" ? "Closeness" : "Name"}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--ink-4)", fontSize: "12px" }}>
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--ink-4)", fontSize: "12px" }}>
          {persons.length === 0 ? "No contacts yet. Add someone to get started." : "No results."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {filtered.map(p => (
            <PersonCard key={p.id} person={p} />
          ))}
        </div>
      )}

      {showAdd && (
        <AddPersonModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
          totalPersons={persons.length}
        />
      )}
    </div>
  )
}
