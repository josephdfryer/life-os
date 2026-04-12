"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import PersonCard from "@/components/persons/PersonCard"
import AddPersonModal from "@/components/persons/AddPersonModal"
import type { PersonWithAttention } from "@/types"

type SortKey = "name" | "closeness" | "recent"

type FieldKey = "first" | "last" | "email" | "phone" | "company" | "headline" | "birthday" | "location" | "linkedin" | "twitter" | "website" | "notes"

const FIELD_CHIPS: { key: FieldKey; label: string }[] = [
  { key: "first",    label: "First name" },
  { key: "last",     label: "Last name"  },
  { key: "email",    label: "Email"      },
  { key: "phone",    label: "Phone"      },
  { key: "company",  label: "Company"    },
  { key: "headline", label: "Headline"   },
  { key: "birthday", label: "Birthday"   },
  { key: "location", label: "Location"   },
  { key: "linkedin", label: "LinkedIn"   },
  { key: "twitter",  label: "Twitter"    },
  { key: "website",  label: "Website"    },
  { key: "notes",    label: "Notes"      },
]

const LIMIT = 50

type PageData = {
  persons:  PersonWithAttention[]
  total:    number
  hasMore:  boolean
}

export default function PeoplePage() {
  const [data, setData]               = useState<PageData>({ persons: [], total: 0, hasMore: false })
  const [search, setSearch]           = useState("")
  const [sort, setSort]               = useState<SortKey>("name")
  const [requiredFields, setRequiredFields] = useState<Set<FieldKey>>(new Set())
  const [showFieldFilters, setShowFieldFilters] = useState(false)
  const [showAdd, setShowAdd]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage]               = useState(0)
  const searchTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchPage = useCallback(async (p: number, q: string, s: SortKey, fields: Set<FieldKey>, reset: boolean) => {
    if (reset) setLoading(true); else setLoadingMore(true)
    try {
      const params = new URLSearchParams({
        minimal: "true",
        page:    String(p),
        limit:   String(LIMIT),
        sort:    s,
        ...(q ? { search: q } : {}),
        ...(fields.size > 0 ? { fields: Array.from(fields).join(",") } : {}),
      })
      const res = await fetch(`/api/persons?${params}`)
      if (!res.ok) return
      const json = await res.json()
      setData(prev => ({
        persons:  reset ? json.persons : [...prev.persons, ...json.persons],
        total:    json.total,
        hasMore:  json.hasMore,
      }))
    } finally {
      if (reset) setLoading(false); else setLoadingMore(false)
    }
  }, [])

  useEffect(() => { fetchPage(0, "", "name", new Set(), true) }, [fetchPage])

  function handleSearch(q: string) {
    setSearch(q)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(0)
      fetchPage(0, q, sort, requiredFields, true)
    }, 300)
  }

  function handleSort(s: SortKey) {
    setSort(s)
    setPage(0)
    fetchPage(0, search, s, requiredFields, true)
  }

  function toggleField(key: FieldKey) {
    setRequiredFields(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      setPage(0)
      fetchPage(0, search, sort, next, true)
      return next
    })
  }

  function clearFieldFilters() {
    const empty = new Set<FieldKey>()
    setRequiredFields(empty)
    setPage(0)
    fetchPage(0, search, sort, empty, true)
  }

  function loadMore() {
    const next = page + 1
    setPage(next)
    fetchPage(next, search, sort, requiredFields, false)
  }

  function reload() {
    setPage(0)
    fetchPage(0, search, sort, requiredFields, true)
  }

  const { persons, total, hasMore } = data
  const filtersActive = requiredFields.size > 0

  return (
    <div style={{ maxWidth: "760px", margin: "0 auto", padding: "32px 24px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontFamily: "var(--font-playfair), serif", fontSize: "28px", fontWeight: 600, color: "var(--ink)", margin: 0 }}>
          People
          {!loading && (
            <span style={{ fontSize: "14px", fontWeight: 400, color: filtersActive ? "var(--accent)" : "var(--ink-4)", marginLeft: "10px" }}>
              {total.toLocaleString()}
              {filtersActive && <span style={{ fontSize: "11px", color: "var(--ink-4)", marginLeft: "4px" }}>filtered</span>}
            </span>
          )}
        </h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <Link href="/contacts/merge" style={{ padding: "9px 16px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "7px", fontFamily: "inherit", fontSize: "12px", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "5px" }}>
            ⇄ Dedupe
          </Link>
          <button
            onClick={() => setShowAdd(true)}
            style={{ padding: "9px 18px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "7px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 500 }}
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
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search by name, email, company, headline…"
          style={{ width: "100%", padding: "10px 14px 10px 36px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--ink)", fontFamily: "inherit", fontSize: "12px", boxSizing: "border-box" }}
        />
        <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: "13px" }}>⊕</span>
      </div>

      {/* Sort + Filter toggle row */}
      <div style={{ display: "flex", gap: "6px", marginBottom: showFieldFilters ? "10px" : "16px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "10px", color: "var(--ink-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Sort:</span>
        {(["name", "closeness", "recent"] as SortKey[]).map(s => (
          <button
            key={s}
            onClick={() => handleSort(s)}
            style={{ padding: "4px 11px", borderRadius: "6px", border: `1px solid ${sort === s ? "var(--accent)" : "var(--border)"}`, background: sort === s ? "var(--accent-soft)" : "transparent", color: sort === s ? "var(--accent)" : "var(--ink-3)", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}
          >
            {s === "name" ? "Name" : s === "closeness" ? "Closeness" : "Recently Added"}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
          {filtersActive && (
            <button
              onClick={clearFieldFilters}
              style={{ fontSize: "10px", color: "var(--ink-4)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
            >
              Clear filters
            </button>
          )}
          <button
            onClick={() => setShowFieldFilters(f => !f)}
            style={{
              padding: "4px 11px", borderRadius: "6px", fontFamily: "inherit", fontSize: "11px", cursor: "pointer",
              border: `1px solid ${filtersActive ? "var(--accent)" : "var(--border)"}`,
              background: filtersActive ? "var(--accent-soft)" : "transparent",
              color: filtersActive ? "var(--accent)" : "var(--ink-3)",
            }}
          >
            {filtersActive ? `⊙ ${requiredFields.size} filter${requiredFields.size === 1 ? "" : "s"}` : "⊙ Filter fields"}
          </button>
        </div>
      </div>

      {/* Field filter chips */}
      {showFieldFilters && (
        <div style={{ marginBottom: "16px", padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }}>
          <div style={{ fontSize: "10px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
            Show only people with…
          </div>
          <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
            {FIELD_CHIPS.map(({ key, label }) => {
              const active = requiredFields.has(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleField(key)}
                  style={{
                    padding: "4px 10px", borderRadius: "20px", fontFamily: "inherit", fontSize: "10px", cursor: "pointer",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    background: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--accent)" : "var(--ink-3)",
                    transition: "all 0.1s",
                  }}
                >
                  {active ? "✓ " : ""}{label}
                </button>
              )
            })}
          </div>
          {filtersActive && (
            <div style={{ marginTop: "8px", fontSize: "10px", color: "var(--ink-4)" }}>
              Showing people with: <span style={{ color: "var(--ink-3)" }}>{Array.from(requiredFields).map(k => FIELD_CHIPS.find(c => c.key === k)?.label).join(" + ")}</span>
            </div>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--ink-4)", fontSize: "12px" }}>Loading…</div>
      ) : persons.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--ink-4)", fontSize: "12px" }}>
          {total === 0 && !filtersActive
            ? "No people yet. Add someone to get started."
            : filtersActive
            ? "No people match the selected field filters."
            : "No results for that search."}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {persons.map(p => <PersonCard key={p.id} person={p} />)}
          </div>

          {hasMore && (
            <div style={{ textAlign: "center", marginTop: "20px" }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{ padding: "10px 28px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--ink-3)", cursor: loadingMore ? "wait" : "pointer", fontFamily: "inherit", fontSize: "12px" }}
              >
                {loadingMore ? "Loading…" : `Load more · ${total - persons.length} remaining`}
              </button>
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: "12px", fontSize: "10px", color: "var(--ink-4)" }}>
            Showing {persons.length.toLocaleString()} of {total.toLocaleString()}
          </div>
        </>
      )}

      {showAdd && (
        <AddPersonModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); reload() }}
          totalPersons={total}
        />
      )}
    </div>
  )
}
