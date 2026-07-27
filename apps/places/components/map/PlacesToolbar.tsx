"use client"

import { startTransition } from "react"
import Link from "next/link"
import { formatInteger, formatRoundedCurrency } from "@/lib/format"
import type { PlacesExplorerState } from "./explorer-state"

type TypeOption = { value: string; count: number }
type SparseCounts = {
  favorites: number
  people: number
  photos: number
  notes: number
  spending: number
  plans: number
}
type FacetCounts = {
  recency: { "30d": number; "1y": number; older: number }
  firstVisited: { "1y": number; older: number }
  minVisits: { 2: number; 5: number; 10: number }
}

export function PlacesToolbar({
  state,
  placeCount,
  filteredCount,
  totalSpend,
  unresolvedCount,
  typeOptions,
  sparseCounts,
  facetCounts,
  onUpdate,
  onReviewToggle,
}: {
  state: PlacesExplorerState
  placeCount: number
  filteredCount: number
  totalSpend: number
  unresolvedCount: number
  typeOptions: TypeOption[]
  sparseCounts: SparseCounts
  facetCounts: FacetCounts
  onUpdate: (patch: Partial<PlacesExplorerState>, history?: "push" | "replace") => void
  onReviewToggle: () => void
}) {
  const hasSparseContext = Object.values(sparseCounts).some(Boolean)
  const hasActiveFilters = Boolean(state.query || state.type !== "all" || state.recency !== "any" || state.firstVisited !== "any" || state.minVisits || state.bounds)

  return (
    <>
      <header className="places-explorer-header">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", fontWeight: 400, letterSpacing: "-0.02em", margin: 0, color: "var(--ink)" }}>Places</h1>
          <div style={{ color: "var(--ink-3)", fontSize: "12px", marginTop: "4px" }}>
            {formatInteger(filteredCount)} of {formatInteger(placeCount)} {placeCount === 1 ? "place" : "places"}
            {totalSpend > 0 ? ` · ${formatRoundedCurrency(totalSpend)} recorded spend` : ""}
          </div>
        </div>
        <div className="places-header-actions">
          {unresolvedCount ? (
            <button
              type="button"
              className={`places-review-callout${state.mode === "review" ? " is-active" : ""}`}
              onClick={onReviewToggle}
            >
              <span>{state.mode === "review" ? "Back to places" : "Review visits"}</span>
              {state.mode !== "review" ? <strong>{formatInteger(unresolvedCount)}</strong> : null}
            </button>
          ) : null}
          <Link href="/places/import" className="places-import-link">Import</Link>
        </div>
      </header>

      {placeCount ? (
        <div className="places-toolbar" aria-label="Find and organize places">
          <label className="places-search">
            <span className="places-sr-only">Search places</span>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={state.query}
              placeholder="Search places or addresses"
              onChange={event => {
                const query = event.target.value
                startTransition(() => onUpdate({ query, selectedId: null }))
              }}
            />
            {state.query ? <button type="button" aria-label="Clear search" onClick={() => onUpdate({ query: "", selectedId: null })}>×</button> : null}
          </label>

          <FilterSelect label="Type" value={state.type} onChange={value => onUpdate({ type: value, selectedId: null })}>
            <option value="all">All types ({placeCount})</option>
            {typeOptions.map(option => <option key={option.value} value={option.value}>{labelize(option.value)} ({option.count})</option>)}
          </FilterSelect>

          <FilterSelect label="Visited" value={state.recency} onChange={value => onUpdate({ recency: value as PlacesExplorerState["recency"], selectedId: null })}>
            <option value="any">Any time</option>
            <option value="30d">Last 30 days ({facetCounts.recency["30d"]})</option>
            <option value="1y">Last year ({facetCounts.recency["1y"]})</option>
            <option value="older">More than a year ago ({facetCounts.recency.older})</option>
          </FilterSelect>

          <FilterSelect label="First visit" value={state.firstVisited} onChange={value => onUpdate({ firstVisited: value as PlacesExplorerState["firstVisited"], selectedId: null })}>
            <option value="any">Any time</option>
            <option value="1y">First seen this year ({facetCounts.firstVisited["1y"]})</option>
            <option value="older">Known over a year ({facetCounts.firstVisited.older})</option>
          </FilterSelect>

          <FilterSelect label="Visits" value={String(state.minVisits)} onChange={value => onUpdate({ minVisits: Number(value), selectedId: null })}>
            <option value="0">Any number</option>
            <option value="2">2+ ({facetCounts.minVisits[2]})</option>
            <option value="5">5+ ({facetCounts.minVisits[5]})</option>
            <option value="10">10+ ({facetCounts.minVisits[10]})</option>
          </FilterSelect>

          <FilterSelect label="Sort" value={state.sort} onChange={value => onUpdate({ sort: value as PlacesExplorerState["sort"] })}>
            <option value="recent">Recently visited</option>
            <option value="visits">Most visited</option>
            <option value="name">A–Z</option>
          </FilterSelect>

          <div className="places-view-switcher" aria-label="Places layout">
            {(["split", "map", "list"] as const).map(view => (
              <button key={view} type="button" aria-pressed={state.view === view} onClick={() => onUpdate({ view }, "push")}>{labelize(view)}</button>
            ))}
          </div>
        </div>
      ) : null}

      {hasActiveFilters ? <ActiveFilters state={state} onUpdate={onUpdate} /> : null}

      {hasSparseContext ? (
        <div className="places-data-note" aria-label="Available place context">
          Available context:
          {sparseCounts.favorites ? ` ${sparseCounts.favorites} favorite${sparseCounts.favorites === 1 ? "" : "s"}` : ""}
          {sparseCounts.people ? ` · ${sparseCounts.people} with people` : ""}
          {sparseCounts.photos ? ` · ${sparseCounts.photos} with photos` : ""}
          {sparseCounts.notes ? ` · ${sparseCounts.notes} with notes` : ""}
          {sparseCounts.spending ? ` · ${sparseCounts.spending} with spending` : ""}
        </div>
      ) : null}
    </>
  )
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="places-select">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)}>{children}</select>
    </label>
  )
}

function ActiveFilters({ state, onUpdate }: { state: PlacesExplorerState; onUpdate: (patch: Partial<PlacesExplorerState>) => void }) {
  return (
    <div className="places-filter-chips" aria-label="Active filters">
      <span>Filtered by</span>
      {state.query ? <button type="button" onClick={() => onUpdate({ query: "", selectedId: null })}>Search: {state.query} ×</button> : null}
      {state.type !== "all" ? <button type="button" onClick={() => onUpdate({ type: "all", selectedId: null })}>Type: {labelize(state.type)} ×</button> : null}
      {state.recency !== "any" ? <button type="button" onClick={() => onUpdate({ recency: "any", selectedId: null })}>Visited: {recencyLabel(state.recency)} ×</button> : null}
      {state.firstVisited !== "any" ? <button type="button" onClick={() => onUpdate({ firstVisited: "any", selectedId: null })}>First visit: {firstVisitLabel(state.firstVisited)} ×</button> : null}
      {state.minVisits ? <button type="button" onClick={() => onUpdate({ minVisits: 0, selectedId: null })}>{state.minVisits}+ visits ×</button> : null}
      {state.bounds ? <button type="button" onClick={() => onUpdate({ bounds: null, selectedId: null })}>Map area ×</button> : null}
      <button type="button" className="places-clear-filters" onClick={() => onUpdate({ query: "", type: "all", recency: "any", firstVisited: "any", minVisits: 0, bounds: null, selectedId: null })}>Clear all</button>
    </div>
  )
}

function labelize(value?: string) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()) : ""
}

function recencyLabel(value: PlacesExplorerState["recency"]) {
  if (value === "30d") return "Last 30 days"
  if (value === "1y") return "Last year"
  if (value === "older") return "More than a year ago"
  return "Any time"
}

function firstVisitLabel(value: PlacesExplorerState["firstVisited"]) {
  if (value === "1y") return "First seen this year"
  if (value === "older") return "Known over a year"
  return "Any time"
}
