"use client"

import { useEffect, useState, useCallback, useRef, useMemo, memo } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import PersonCard from "@/components/persons/PersonCard"
import PersonCardSkeleton from "@/components/persons/PersonCardSkeleton"
import AddPersonModal from "@/components/persons/AddPersonModal"
import type { PersonListPerson } from "@/types"
import type { PersonListView } from "@/lib/person-list-presentation"
import { filtersToParam, type Filter } from "@/lib/filters"
import { Toolbar } from "./Toolbar"
import { fetchWithCache, prefetch, apiCache } from "@/lib/api-cache"

type SortKey = "name" | "closeness" | "recent"

const LIMIT = 50

type PageData = {
  persons:  PersonListPerson[]
  total:    number
  hasMore:  boolean
}

export default function PersonsClient({ initialData }: { initialData: PageData | null }) {
  const [data, setData]               = useState<PageData>(initialData ?? { persons: [], total: 0, hasMore: false })
  const [search, setSearch]           = useState("")
  const [sort, setSort]               = useState<SortKey>("name")
  const [view, setView]               = useState<PersonListView>("all")
  const [filters, setFilters]         = useState<Filter[]>([])
  const [showAdd, setShowAdd]         = useState(false)
  const [loading, setLoading]         = useState(!initialData)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage]               = useState(0)
  const searchTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef                   = useRef<HTMLDivElement | null>(null)
  const parentRef                     = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef                = useRef(false)
  const skipFirstFetch                = useRef(!!initialData)
  const requestVersionRef             = useRef(0)

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

  // Virtual scrolling for performance with large lists
  const rowVirtualizer = useVirtualizer({
    count: data.persons.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 90, // Estimated row height in pixels
    overscan: 5, // Render 5 extra items above and below viewport
  })

  const fetchPage = useCallback(async (p: number, q: string, s: SortKey, v: PersonListView, activeFilters: Filter[], reset: boolean) => {
    if (!reset && loadingMoreRef.current) return
    const requestVersion = reset ? requestVersionRef.current + 1 : requestVersionRef.current
    if (reset) {
      requestVersionRef.current = requestVersion
      loadingMoreRef.current = false
      setLoadingMore(false)
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
        view:    v,
        ...(q ? { search: q } : {}),
        ...(activeFilters.length > 0 ? { filters: filtersToParam(activeFilters) } : {}),
      })
      const url = `/api/persons?${params}`
      
      // Use cached fetch with deduplication
      type PersonsResponse = { persons: PersonListPerson[]; total: number; hasMore: boolean }
      const json = await fetchWithCache<PersonsResponse>(url)
      
      if (requestVersion !== requestVersionRef.current) return
      setData(prev => ({
        persons:  reset ? json.persons : [...prev.persons, ...json.persons],
        total:    json.total,
        hasMore:  json.hasMore,
      }))
      
      // Prefetch next page in background
      if (json.hasMore) {
        const nextParams = new URLSearchParams({
          minimal: "true",
          page:    String(p + 1),
          limit:   String(LIMIT),
          sort:    s,
          view:    v,
          ...(q ? { search: q } : {}),
          ...(activeFilters.length > 0 ? { filters: filtersToParam(activeFilters) } : {}),
        })
        prefetch(`/api/persons?${nextParams}`)
      }
    } catch (error) {
      console.error('Failed to fetch persons:', error)
    } finally {
      if (requestVersion === requestVersionRef.current) {
        if (reset) {
          setLoading(false)
        } else {
          loadingMoreRef.current = false
          setLoadingMore(false)
        }
      }
    }
  }, [])

  useEffect(() => {
    if (skipFirstFetch.current) { skipFirstFetch.current = false; return }
    fetchPage(0, "", "name", "all", [], true)
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
      fetchPage(0, q, sort, view, filters, true)
    }, 300)
  }

  function handleSort(s: SortKey) {
    setSort(s)
    setPage(0)
    fetchPage(0, search, s, view, filters, true)
  }

  function handleView(nextView: PersonListView) {
    setView(nextView)
    setPage(0)
    setSelected(new Set())
    fetchPage(0, search, sort, nextView, filters, true)
  }

  function handleAddFilter(filter: Filter) {
    setFilters(prev => {
      const next = [...prev, filter]
      setPage(0)
      fetchPage(0, search, sort, view, next, true)
      return next
    })
  }

  function handleRemoveFilter(id: string) {
    setFilters(prev => {
      const next = prev.filter(f => f.id !== id)
      setPage(0)
      fetchPage(0, search, sort, view, next, true)
      return next
    })
  }

  function clearFilters() {
    setFilters([])
    setPage(0)
    fetchPage(0, search, sort, view, [], true)
  }

  const loadMore = useCallback(() => {
    if (loading || loadingMoreRef.current || !data.hasMore) return
    const next = page + 1
    setPage(next)
    fetchPage(next, search, sort, view, filters, false)
  }, [data.hasMore, fetchPage, filters, loading, page, search, sort, view])

  useEffect(() => {
    const sentinel = sentinelRef.current
    const parent = parentRef.current
    if (!sentinel || !parent || loading || !data.hasMore) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { root: parent, rootMargin: "640px 0px 320px" },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [data.hasMore, loadMore, loading])

  function reload() {
    // Invalidate cache when reloading
    apiCache.invalidate(/\/api\/persons/)
    setPage(0)
    setSelected(new Set())
    fetchPage(0, search, sort, view, filters, true)
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function toggleSelectMode() {
    if (selectMode) exitSelectMode()
    else setSelectMode(true)
  }

  function openDeleteAllModal() {
    setShowDeleteAll(true)
    setDeleteAllInput("")
    setDeleteAllError("")
    setDeleteAllBackedUp(false)
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
  const fieldFiltersActive = filters.length > 0
  const filtersActive = fieldFiltersActive || view !== "all"
  const allVisibleSelected = persons.length > 0 && selected.size === persons.length

  return (
    <div style={{ width: "min(100%, var(--content-max, 1100px))", margin: "0 auto", padding: "36px 24px 48px" }}>

      <Toolbar
        total={total}
        loading={loading}
        filtersActive={filtersActive}
        selectMode={selectMode}
        onToggleSelectMode={toggleSelectMode}
        onShowAdd={() => setShowAdd(true)}
        onShowDeleteAll={openDeleteAllModal}
        search={search}
        onSearch={handleSearch}
        view={view}
        onView={handleView}
        sort={sort}
        onSort={handleSort}
        filters={filters}
        onAddFilter={handleAddFilter}
        onRemoveFilter={handleRemoveFilter}
        onClearFilters={clearFilters}
      />

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
        <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <PersonCardSkeleton key={i} />
          ))}
        </div>
      ) : persons.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--ink-4)", fontSize: "12px" }}>
          {total === 0 && !filtersActive
            ? "No people yet. Add someone to get started."
            : view === "attention"
            ? "No relationships need attention right now."
            : view === "active"
            ? "No interactions have been recorded this month."
            : view === "no-history"
            ? "Everyone here has some interaction history."
            : fieldFiltersActive
            ? "No people match the selected field filters."
            : "No results for that search."}
        </div>
      ) : (
        <>
          <div 
            ref={parentRef}
            style={{ 
              height: "calc(100vh - 280px)", 
              overflow: "auto",
              minHeight: "400px"
            }}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const p = persons[virtualRow.index]
                return (
                  <div
                    key={p.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {selectMode ? (
                      <SelectablePersonRow
                        person={p}
                        selected={selected.has(p.id)}
                        onToggle={() => toggleSelectPerson(p.id)}
                      />
                    ) : (
                      <PersonCard person={p} />
                    )}
                  </div>
                )
              })}
            </div>
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

const SelectablePersonRow = memo(function SelectablePersonRow({
  person,
  selected,
  onToggle,
}: {
  person: PersonListPerson
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        textAlign: "left",
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
    </button>
  )
})
