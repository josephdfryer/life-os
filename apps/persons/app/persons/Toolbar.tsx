"use client"

import Link from "next/link"
import type { PersonListView } from "@/lib/person-list-presentation"
import type { Filter } from "@/lib/filters"
import { FilterBar } from "./FilterBar"
import styles from "./persons.module.css"

type SortKey = "name" | "closeness" | "recent"

const VIEWS: [PersonListView, string][] = [
  ["all", "All"],
  ["attention", "Needs attention"],
  ["active", "Active this month"],
  ["no-history", "No history"],
]

const SORTS: [SortKey, string][] = [
  ["name", "Name"],
  ["closeness", "Closeness"],
  ["recent", "Recently Added"],
]

export function Toolbar({
  total,
  loading,
  filtersActive,
  selectMode,
  onToggleSelectMode,
  onShowAdd,
  onShowDeleteAll,
  search,
  onSearch,
  view,
  onView,
  sort,
  onSort,
  filters,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
}: {
  total: number
  loading: boolean
  filtersActive: boolean
  selectMode: boolean
  onToggleSelectMode: () => void
  onShowAdd: () => void
  onShowDeleteAll: () => void
  search: string
  onSearch: (q: string) => void
  view: PersonListView
  onView: (v: PersonListView) => void
  sort: SortKey
  onSort: (s: SortKey) => void
  filters: Filter[]
  onAddFilter: (f: Filter) => void
  onRemoveFilter: (id: string) => void
  onClearFilters: () => void
}) {
  return (
    <>
      {/* Header */}
      <div className={styles.headerRow} style={{ marginBottom: "24px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", fontWeight: 400, letterSpacing: "-0.02em", color: "var(--ink)", margin: 0 }}>
          Persons
          {!loading && (
            <span style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 400, color: filtersActive ? "var(--cognac)" : "var(--ink-4)", marginLeft: "10px" }}>
              {total.toLocaleString()}
              {filtersActive && <span style={{ fontSize: "11px", color: "var(--ink-4)", marginLeft: "4px" }}>filtered</span>}
            </span>
          )}
        </h1>
        <div className={styles.headerActions}>
          <button
            className={styles.selectButton}
            onClick={onToggleSelectMode}
            style={{ padding: "9px 16px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
          <details style={{ position: "relative" }}>
            <summary style={{ listStyle: "none", padding: "9px 16px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", cursor: "pointer", fontSize: "13px" }}>
              Manage
            </summary>
            <div style={{ position: "absolute", zIndex: 20, top: "calc(100% + 8px)", right: 0, width: "190px", padding: "8px", display: "grid", gap: "3px", background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)" }}>
              <button
                type="button"
                className={styles.selectMenuItem}
                onClick={onToggleSelectMode}
                style={{ padding: "9px 10px", textAlign: "left", background: "transparent", border: 0, color: "var(--ink-2)", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", borderRadius: "var(--radius-sm)" }}
              >
                {selectMode ? "Cancel select" : "Select people"}
              </button>
              <a href="/api/persons/export" download style={{ padding: "9px 10px", color: "var(--ink-2)", textDecoration: "none", fontSize: "12px", borderRadius: "var(--radius-sm)" }} title="Download full backup as JSON">
                Download backup
              </a>
              <Link href="/persons/clean" style={{ padding: "9px 10px", color: "var(--ink-2)", textDecoration: "none", fontSize: "12px", borderRadius: "var(--radius-sm)" }}>
                Data cleaning
              </Link>
              <Link href="/persons/merge" style={{ padding: "9px 10px", color: "var(--ink-2)", textDecoration: "none", fontSize: "12px", borderRadius: "var(--radius-sm)" }}>
                Find duplicates
              </Link>
              <div style={{ height: "1px", background: "var(--border-subtle)", margin: "4px 0" }} />
              <button
                type="button"
                onClick={onShowDeleteAll}
                style={{ padding: "9px 10px", textAlign: "left", background: "transparent", border: 0, color: "var(--attention)", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", borderRadius: "var(--radius-sm)" }}
              >
                Delete all people…
              </button>
            </div>
          </details>
          <button
            className={styles.addPersonButton}
            onClick={onShowAdd}
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
          onChange={e => onSearch(e.target.value)}
          placeholder="Search by name, email, company, headline…"
          style={{ width: "100%", padding: "11px 14px 11px 36px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--ink)", fontFamily: "inherit", fontSize: "14px", boxSizing: "border-box", boxShadow: "var(--shadow-sm)" }}
        />
        <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--ink-4)", fontSize: "13px" }}>⊕</span>
      </div>

      {/* Relationship views */}
      <nav aria-label="Person list views" style={{ display: "flex", gap: "6px", marginBottom: "12px", overflowX: "auto", paddingBottom: "1px" }}>
        {VIEWS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => onView(key)}
            style={{ flexShrink: 0, padding: "7px 14px", borderRadius: "var(--radius-pill)", border: `1px solid ${view === key ? "var(--cognac-soft)" : "var(--border)"}`, background: view === key ? "var(--cognac-soft)" : "transparent", color: view === key ? "var(--cognac-deep)" : "var(--ink-3)", fontFamily: "inherit", fontSize: "12px", cursor: "pointer" }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Sort + compound filters row */}
      <div className={styles.sortRow} style={{ marginBottom: "16px" }}>
        <span style={{ fontSize: "10px", color: "var(--ink-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Sort:</span>
        <div className={styles.sortPills}>
          {SORTS.map(([s, label]) => (
            <button
              key={s}
              onClick={() => onSort(s)}
              style={{ padding: "6px 13px", borderRadius: "var(--radius-pill)", border: `1px solid ${sort === s ? "var(--cognac-soft)" : "var(--border)"}`, background: sort === s ? "var(--surface)" : "transparent", color: sort === s ? "var(--cognac-deep)" : "var(--ink-3)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit", boxShadow: sort === s ? "var(--shadow-sm)" : "none" }}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className={styles.sortSelect}
          value={sort}
          onChange={e => onSort(e.target.value as SortKey)}
          style={{ padding: "7px 10px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink-2)", fontFamily: "inherit", fontSize: "13px" }}
        >
          {SORTS.map(([s, label]) => (
            <option key={s} value={s}>{label}</option>
          ))}
        </select>
        <div className={styles.filterBarSlot}>
          <FilterBar filters={filters} onAdd={onAddFilter} onRemove={onRemoveFilter} onClear={onClearFilters} />
        </div>
      </div>
    </>
  )
}
