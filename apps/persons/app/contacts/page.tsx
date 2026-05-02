"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import PersonCard from "@/components/persons/PersonCard"
import AddPersonModal from "@/components/persons/AddPersonModal"
import type { PersonWithAttention } from "@/types"

type SortKey = "name" | "closeness" | "recent"

type FieldKey = "first" | "last" | "email" | "phone" | "company" | "title" | "headline" | "birthday" | "location" | "linkedin" | "twitter" | "website" | "notes"
type ValueFilterKey = "location" | "title" | "company" | "headline"

const FIELD_CHIPS: { key: FieldKey; label: string }[] = [
  { key: "first",    label: "First name" },
  { key: "last",     label: "Last name"  },
  { key: "email",    label: "Email"      },
  { key: "phone",    label: "Phone"      },
  { key: "company",  label: "Company"    },
  { key: "title",    label: "Title"      },
  { key: "headline", label: "Headline"   },
  { key: "birthday", label: "Birthday"   },
  { key: "location", label: "Location"   },
  { key: "linkedin", label: "LinkedIn"   },
  { key: "twitter",  label: "Twitter"    },
  { key: "website",  label: "Website"    },
  { key: "notes",    label: "Notes"      },
]

const VALUE_FILTERS: { key: ValueFilterKey; label: string; placeholder: string }[] = [
  { key: "location", label: "Location", placeholder: "Start typing a city, region, or country" },
  { key: "title",    label: "Title",    placeholder: "Start typing a role or job title" },
  { key: "company",  label: "Company",  placeholder: "Start typing an employer or org" },
  { key: "headline", label: "Headline", placeholder: "Start typing anything from a headline" },
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
  const [valueFilters, setValueFilters] = useState<Record<ValueFilterKey, string>>({ location: "", title: "", company: "", headline: "" })
  const [showFieldFilters, setShowFieldFilters] = useState(false)
  const [showAdd, setShowAdd]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage]               = useState(0)
  const searchTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef                   = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef                = useRef(false)

  const fetchPage = useCallback(async (p: number, q: string, s: SortKey, fields: Set<FieldKey>, values: Record<ValueFilterKey, string>, reset: boolean) => {
    if (!reset && loadingMoreRef.current) return
    if (reset) {
      setLoading(true)
    } else {
      loadingMoreRef.current = true
      setLoadingMore(true)
    }
    try {
      const params = new URLSearchParams({
        minimal: "true",
        page:    String(p),
        limit:   String(LIMIT),
        sort:    s,
        ...(q ? { search: q } : {}),
        ...(fields.size > 0 ? { fields: Array.from(fields).join(",") } : {}),
        ...Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())),
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
      if (reset) {
        setLoading(false)
      } else {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => { fetchPage(0, "", "name", new Set(), valueFilters, true) }, [fetchPage])

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  function handleSearch(q: string) {
    setSearch(q)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(0)
      fetchPage(0, q, sort, requiredFields, valueFilters, true)
    }, 300)
  }

  function handleSort(s: SortKey) {
    setSort(s)
    setPage(0)
    fetchPage(0, search, s, requiredFields, valueFilters, true)
  }

  function toggleField(key: FieldKey) {
    setRequiredFields(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      setPage(0)
      fetchPage(0, search, sort, next, valueFilters, true)
      return next
    })
  }

  function setValueFilter(key: ValueFilterKey, value: string) {
    const next = { ...valueFilters, [key]: value }
    setValueFilters(next)
    setPage(0)
    fetchPage(0, search, sort, requiredFields, next, true)
  }

  function clearFieldFilters() {
    const empty = new Set<FieldKey>()
    const emptyValues = { location: "", title: "", company: "", headline: "" }
    setRequiredFields(empty)
    setValueFilters(emptyValues)
    setPage(0)
    fetchPage(0, search, sort, empty, emptyValues, true)
  }

  const loadMore = useCallback(() => {
    if (loading || loadingMoreRef.current || !data.hasMore) return
    const next = page + 1
    setPage(next)
    fetchPage(next, search, sort, requiredFields, valueFilters, false)
  }, [data.hasMore, fetchPage, loading, page, requiredFields, search, sort, valueFilters])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || loading || !data.hasMore) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: "640px 0px 320px" },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [data.hasMore, loadMore, loading])

  function reload() {
    setPage(0)
    fetchPage(0, search, sort, requiredFields, valueFilters, true)
  }

  const { persons, total, hasMore } = data
  const valueFilterCount = Object.values(valueFilters).filter(Boolean).length
  const filtersActive = requiredFields.size > 0 || valueFilterCount > 0

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
            {filtersActive ? `⊙ ${requiredFields.size + valueFilterCount} filter${requiredFields.size + valueFilterCount === 1 ? "" : "s"}` : "⊙ Filters"}
          </button>
        </div>
      </div>

      {/* Field filter chips */}
      {showFieldFilters && (
        <div style={{ marginBottom: "16px", padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px", marginBottom: "14px" }}>
            {VALUE_FILTERS.map(filter => (
              <FacetFilter
                key={filter.key}
                field={filter.key}
                label={filter.label}
                value={valueFilters[filter.key]}
                placeholder={filter.placeholder}
                onChange={value => setValueFilter(filter.key, value)}
              />
            ))}
          </div>
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
              Showing people with: <span style={{ color: "var(--ink-3)" }}>{[
                ...VALUE_FILTERS.flatMap(f => valueFilters[f.key] ? [`${f.label}: ${valueFilters[f.key]}`] : []),
                ...Array.from(requiredFields).map(k => FIELD_CHIPS.find(c => c.key === k)?.label).filter(Boolean),
              ].join(" + ")}</span>
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
            <div ref={sentinelRef} style={{ textAlign: "center", marginTop: "20px", minHeight: "44px" }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{ padding: "10px 28px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--ink-3)", cursor: loadingMore ? "wait" : "pointer", fontFamily: "inherit", fontSize: "12px" }}
              >
                {loadingMore ? "Loading more…" : `Load more now · ${total - persons.length} remaining`}
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

function FacetFilter({
  field,
  label,
  value,
  placeholder,
  onChange,
}: {
  field: ValueFilterKey
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [suggestions, setSuggestions] = useState<{ value: string; count: number }[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const params = new URLSearchParams({ field, q: draft, limit: "8" })
      const res = await fetch(`/api/persons/facets?${params}`)
      if (!res.ok) return
      const json = await res.json()
      setSuggestions(json.values ?? [])
    }, 150)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [draft, field])

  function commit(next: string) {
    setDraft(next)
    onChange(next.trim())
    setOpen(false)
  }

  return (
    <div style={{ position: "relative" }}>
      <label style={{ display: "block", fontSize: "10px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "5px" }}>
        {label}
      </label>
      <input
        value={draft}
        onChange={e => {
          setDraft(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => {
          if (e.key === "Enter") commit(draft)
          if (e.key === "Escape") setOpen(false)
        }}
        placeholder={placeholder}
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 28px 8px 10px", background: "var(--surface2)", border: `1px solid ${value ? "var(--accent)" : "var(--border)"}`, borderRadius: "7px", color: "var(--ink)", fontFamily: "inherit", fontSize: "11px" }}
      />
      {value && (
        <button
          type="button"
          onClick={() => commit("")}
          style={{ position: "absolute", right: "7px", bottom: "7px", border: "none", background: "transparent", color: "var(--ink-4)", cursor: "pointer", fontSize: "13px", lineHeight: 1 }}
        >
          ×
        </button>
      )}
      {open && suggestions.length > 0 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: "100%", marginTop: "4px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", boxShadow: "0 12px 30px rgba(0,0,0,0.12)", zIndex: 20, overflow: "hidden" }}>
          {suggestions.map(item => (
            <button
              key={item.value}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => commit(item.value)}
              style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: "10px", padding: "8px 10px", border: "none", background: item.value === value ? "var(--accent-soft)" : "transparent", color: item.value === value ? "var(--accent)" : "var(--ink-2)", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", textAlign: "left" }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.value}</span>
              <span style={{ color: "var(--ink-4)", flexShrink: 0 }}>{item.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
