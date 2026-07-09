"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import PersonCard from "@/components/persons/PersonCard"
import AddPersonModal from "@/components/persons/AddPersonModal"
import type { PersonWithAttention } from "@/types"

type SortKey = "name" | "closeness" | "recent"

type FieldKey = "first" | "last" | "email" | "phone" | "company" | "title" | "headline" | "birthday" | "location" | "linkedin" | "twitter" | "website" | "facebook" | "instagram" | "notes"
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
  { key: "linkedin",  label: "LinkedIn"   },
  { key: "twitter",   label: "Twitter"    },
  { key: "website",   label: "Website"    },
  { key: "facebook",  label: "Facebook"   },
  { key: "instagram", label: "Instagram"  },
  { key: "notes",     label: "Notes"      },
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

export default function PeopleClient({ initialData }: { initialData: PageData | null }) {
  const [data, setData]               = useState<PageData>(initialData ?? { persons: [], total: 0, hasMore: false })
  const [search, setSearch]           = useState("")
  const [sort, setSort]               = useState<SortKey>("name")
  const [requiredFields, setRequiredFields] = useState<Set<FieldKey>>(new Set())
  const [valueFilters, setValueFilters] = useState<Record<ValueFilterKey, string>>({ location: "", title: "", company: "", headline: "" })
  const [showFieldFilters, setShowFieldFilters] = useState(false)
  const [showAdd, setShowAdd]         = useState(false)
  const [loading, setLoading]         = useState(!initialData)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage]               = useState(0)
  const searchTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef                   = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef                = useRef(false)
  const skipFirstFetch                = useRef(!!initialData)

  // Select mode
  const [selectMode, setSelectMode]   = useState(false)
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Delete-all modal
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const [deleteAllInput, setDeleteAllInput] = useState("")
  const [deleteAllBusy, setDeleteAllBusy] = useState(false)
  const [deleteAllError, setDeleteAllError] = useState("")
  const [deleteAllBackedUp, setDeleteAllBackedUp] = useState(false)

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

  useEffect(() => {
    if (skipFirstFetch.current) { skipFirstFetch.current = false; return }
    fetchPage(0, "", "name", new Set(), valueFilters, true)
  }, [fetchPage])

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
    setSelected(new Set())
    fetchPage(0, search, sort, requiredFields, valueFilters, true)
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function toggleSelectPerson(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === data.persons.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(data.persons.map(p => p.id)))
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    setBulkDeleting(true)
    try {
      const res = await fetch("/api/persons/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        alert(json.error ?? "Delete failed")
        return
      }
      exitSelectMode()
      reload()
    } finally {
      setBulkDeleting(false)
    }
  }

  async function handleDeleteAll() {
    if (deleteAllInput !== "DELETE") return
    setDeleteAllBusy(true)
    setDeleteAllError("")
    try {
      const res = await fetch("/api/persons/all", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setDeleteAllError(json.error ?? "Delete failed")
        return
      }
      setShowDeleteAll(false)
      setDeleteAllInput("")
      exitSelectMode()
      reload()
    } finally {
      setDeleteAllBusy(false)
    }
  }

  const { persons, total, hasMore } = data
  const valueFilterCount = Object.values(valueFilters).filter(Boolean).length
  const filtersActive = requiredFields.size > 0 || valueFilterCount > 0
  const allVisibleSelected = persons.length > 0 && selected.size === persons.length

  return (
    <div style={{ width: "min(100%, var(--content-max, 1100px))", margin: "0 auto", padding: "36px 24px 48px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", fontWeight: 400, letterSpacing: "-0.02em", color: "var(--ink)", margin: 0 }}>
          People
          {!loading && (
            <span style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 400, color: filtersActive ? "var(--cognac)" : "var(--ink-4)", marginLeft: "10px" }}>
              {total.toLocaleString()}
              {filtersActive && <span style={{ fontSize: "11px", color: "var(--ink-4)", marginLeft: "4px" }}>filtered</span>}
            </span>
          )}
        </h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <a href="/api/persons/export" download style={{ padding: "9px 16px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", fontFamily: "inherit", fontSize: "13px", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "5px" }} title="Download full backup as JSON">
            Backup
          </a>
          <Link href="/people/clean" style={{ padding: "9px 16px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", fontFamily: "inherit", fontSize: "13px", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "5px" }}>
            Data cleaning
          </Link>
          <Link href="/people/merge" style={{ padding: "9px 16px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", fontFamily: "inherit", fontSize: "13px", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "5px" }}>
            Dedupe
          </Link>
          {selectMode ? (
            <button
              onClick={exitSelectMode}
              style={{ padding: "9px 16px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              style={{ padding: "9px 16px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}
            >
              Select
            </button>
          )}
          <button
            onClick={() => setShowAdd(true)}
            style={{ padding: "9px 18px", background: "var(--cognac)", color: "#fff", border: "none", borderRadius: "var(--radius-pill)", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 450 }}
          >
            Add person
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
          style={{ width: "100%", padding: "11px 14px 11px 36px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--ink)", fontFamily: "inherit", fontSize: "14px", boxSizing: "border-box", boxShadow: "var(--shadow-sm)" }}
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
            style={{ padding: "6px 13px", borderRadius: "var(--radius-pill)", border: `1px solid ${sort === s ? "var(--cognac-soft)" : "var(--border)"}`, background: sort === s ? "var(--surface)" : "transparent", color: sort === s ? "var(--cognac-deep)" : "var(--ink-3)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit", boxShadow: sort === s ? "var(--shadow-sm)" : "none" }}
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
              padding: "6px 13px", borderRadius: "var(--radius-pill)", fontFamily: "inherit", fontSize: "13px", cursor: "pointer",
              border: `1px solid ${filtersActive ? "var(--cognac-soft)" : "var(--border)"}`,
              background: filtersActive ? "var(--cognac-soft)" : "transparent",
              color: filtersActive ? "var(--cognac-deep)" : "var(--ink-3)",
            }}
          >
            {filtersActive ? `${requiredFields.size + valueFilterCount} filter${requiredFields.size + valueFilterCount === 1 ? "" : "s"}` : "Filters"}
          </button>
          <button
            onClick={() => { setShowDeleteAll(true); setDeleteAllInput(""); setDeleteAllError(""); setDeleteAllBackedUp(false) }}
            style={{ padding: "6px 13px", borderRadius: "var(--radius-pill)", fontFamily: "inherit", fontSize: "13px", cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--ink-4)" }}
            title="Danger: delete entire database"
          >
            Nuke all
          </button>
        </div>
      </div>

      {/* Field filter chips */}
      {showFieldFilters && (
        <div style={{ marginBottom: "16px", padding: "16px", background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-sm)" }}>
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
                    padding: "4px 10px", borderRadius: "var(--radius-pill)", fontFamily: "inherit", fontSize: "11px", cursor: "pointer",
                    border: `1px solid ${active ? "var(--cognac-soft)" : "var(--border)"}`,
                    background: active ? "var(--cognac-soft)" : "transparent",
                    color: active ? "var(--cognac-deep)" : "var(--ink-3)",
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

      {/* Bulk action bar */}
      {selectMode && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 14px",
          marginBottom: "12px",
          background: "var(--surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-sm)",
        }}>
          <button
            onClick={toggleSelectAll}
            style={{ padding: "6px 13px", borderRadius: "var(--radius-pill)", border: "1px solid var(--border)", background: allVisibleSelected ? "var(--cognac-soft)" : "transparent", color: allVisibleSelected ? "var(--cognac-deep)" : "var(--ink-3)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}
          >
            {allVisibleSelected ? "Deselect all" : "Select all visible"}
          </button>
          <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>
            {selected.size > 0 ? `${selected.size} selected` : "Click people to select"}
          </span>
          <div style={{ marginLeft: "auto" }}>
            <button
              onClick={handleBulkDelete}
              disabled={selected.size === 0 || bulkDeleting}
              style={{
                padding: "6px 16px",
                borderRadius: "6px",
                border: "1px solid #c44040",
                background: selected.size === 0 ? "transparent" : "rgba(196,64,64,0.1)",
                color: selected.size === 0 ? "var(--ink-4)" : "#c44040",
                fontSize: "12px",
                fontWeight: 500,
                cursor: selected.size === 0 || bulkDeleting ? "default" : "pointer",
                fontFamily: "inherit",
                opacity: bulkDeleting ? 0.6 : 1,
              }}
            >
              {bulkDeleting ? "Deleting…" : `Delete ${selected.size > 0 ? selected.size : ""} selected`}
            </button>
          </div>
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
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {persons.map(p => (
              selectMode ? (
                <SelectablePersonRow
                  key={p.id}
                  person={p}
                  selected={selected.has(p.id)}
                  onToggle={() => toggleSelectPerson(p.id)}
                />
              ) : (
                <PersonCard key={p.id} person={p} />
              )
            ))}
          </div>

          {hasMore && (
            <div ref={sentinelRef} style={{ textAlign: "center", marginTop: "20px", minHeight: "44px" }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{ padding: "10px 28px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", color: "var(--ink-3)", cursor: loadingMore ? "wait" : "pointer", fontFamily: "inherit", fontSize: "13px" }}
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

      {/* Delete-all confirmation modal */}
      {showDeleteAll && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget && !deleteAllBusy) setShowDeleteAll(false) }}
        >
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "14px", padding: "28px 28px 24px", width: "100%", maxWidth: "440px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: "18px", fontWeight: 600, color: "#c44040", marginBottom: "10px" }}>
              Delete entire people database
            </div>
            <p style={{ fontSize: "13px", color: "var(--ink-2)", lineHeight: 1.6, margin: "0 0 16px" }}>
              This will permanently delete <strong>all {total.toLocaleString()} people</strong> and their associated interactions, plans, and notes. This cannot be undone.
            </p>

            {/* Step 1: backup */}
            <div style={{ padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", marginBottom: "14px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                Step 1 — Download a backup first
              </div>
              <a
                href="/api/persons/export"
                download
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "7px", color: "var(--ink-2)", fontSize: "12px", textDecoration: "none" }}
              >
                ↓ Download people-backup.json ({total.toLocaleString()} people)
              </a>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px", cursor: "pointer", fontSize: "12px", color: "var(--ink-3)" }}>
                <input
                  type="checkbox"
                  checked={deleteAllBackedUp}
                  onChange={e => setDeleteAllBackedUp(e.target.checked)}
                  style={{ width: "14px", height: "14px", accentColor: "#c44040", cursor: "pointer" }}
                />
                I have downloaded or already have a backup
              </label>
            </div>

            {/* Step 2: type DELETE */}
            <label style={{ display: "block", fontSize: "11px", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
              Step 2 — Type <strong style={{ color: "#c44040" }}>DELETE</strong> to confirm
            </label>
            <input
              autoFocus
              value={deleteAllInput}
              onChange={e => { setDeleteAllInput(e.target.value); setDeleteAllError("") }}
              onKeyDown={e => { if (e.key === "Enter" && deleteAllInput === "DELETE" && deleteAllBackedUp) handleDeleteAll() }}
              placeholder="DELETE"
              disabled={!deleteAllBackedUp}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", background: deleteAllBackedUp ? "var(--surface)" : "var(--surface2)", border: `1px solid ${deleteAllInput === "DELETE" && deleteAllBackedUp ? "#c44040" : "var(--border)"}`, borderRadius: "8px", color: "var(--ink)", fontFamily: "inherit", fontSize: "13px", marginBottom: "14px", opacity: deleteAllBackedUp ? 1 : 0.5 }}
            />
            {deleteAllError && (
              <div style={{ fontSize: "11px", color: "#c44040", marginBottom: "10px" }}>{deleteAllError}</div>
            )}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowDeleteAll(false)}
                disabled={deleteAllBusy}
                style={{ padding: "9px 20px", borderRadius: "7px", border: "1px solid var(--border)", background: "transparent", color: "var(--ink-3)", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deleteAllInput !== "DELETE" || !deleteAllBackedUp || deleteAllBusy}
                style={{
                  padding: "9px 20px", borderRadius: "7px", border: "none",
                  background: deleteAllInput === "DELETE" && deleteAllBackedUp && !deleteAllBusy ? "#c44040" : "var(--surface2)",
                  color: deleteAllInput === "DELETE" && deleteAllBackedUp && !deleteAllBusy ? "#fff" : "var(--ink-4)",
                  cursor: deleteAllInput === "DELETE" && deleteAllBackedUp && !deleteAllBusy ? "pointer" : "default",
                  fontFamily: "inherit", fontSize: "12px", fontWeight: 500,
                  opacity: deleteAllBusy ? 0.6 : 1,
                }}
              >
                {deleteAllBusy ? "Deleting…" : "Delete everything"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SelectablePersonRow({
  person,
  selected,
  onToggle,
}: {
  person: PersonWithAttention
  selected: boolean
  onToggle: () => void
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        background: selected ? "rgba(196,64,64,0.07)" : "var(--surface)",
        border: `1px solid ${selected ? "#c44040" : "var(--border)"}`,
        borderRadius: "8px",
        padding: "12px 14px",
        cursor: "pointer",
        transition: "all 0.1s",
      }}
    >
      <div style={{
        width: "18px",
        height: "18px",
        borderRadius: "var(--radius-sm)",
        border: `2px solid ${selected ? "var(--attention)" : "var(--border)"}`,
        background: selected ? "var(--attention)" : "transparent",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: "11px",
        fontWeight: 700,
        transition: "all 0.1s",
      }}>
        {selected ? "✓" : ""}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 400, color: "var(--ink)" }}>
          {person.first} {person.last}
        </div>
        {(person.title || person.headline || person.company) && (
          <div style={{ fontSize: "12px", color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
            {person.title ?? person.headline}
            {person.title && person.company ? ` at ${person.company}` : person.company ?? ""}
          </div>
        )}
      </div>
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
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 28px 10px 12px", background: "var(--surface)", border: `1px solid ${value ? "var(--cognac)" : "var(--border)"}`, borderRadius: "var(--radius)", color: "var(--ink)", fontFamily: "inherit", fontSize: "13px" }}
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
        <div style={{ position: "absolute", left: 0, right: 0, top: "100%", marginTop: "4px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", zIndex: 20, overflow: "hidden" }}>
          {suggestions.map(item => (
            <button
              key={item.value}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => commit(item.value)}
              style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: "10px", padding: "8px 10px", border: "none", background: item.value === value ? "var(--cognac-soft)" : "transparent", color: item.value === value ? "var(--cognac-deep)" : "var(--ink-2)", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", textAlign: "left" }}
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
