"use client"

import { useState } from "react"
import { Chip } from "@life-os/ui"
import { filterChipLabel, type Filter, type FilterField } from "@/lib/filters"
import { AddFilterMenu } from "./AddFilterMenu"

export function FilterBar({
  filters,
  onAdd,
  onRemove,
  onClear,
}: {
  filters: Filter[]
  onAdd: (filter: Filter) => void
  onRemove: (id: string) => void
  onClear: () => void
}) {
  const [showAddMenu, setShowAddMenu] = useState(false)
  const existingFields: FilterField[] = filters.map(f => f.field)

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
      {filters.map(f => (
        <Chip key={f.id} label={filterChipLabel(f)} variant="removable" onRemove={() => onRemove(f.id)} />
      ))}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setShowAddMenu(v => !v)}
          style={{
            padding: "6px 13px", borderRadius: "var(--radius-pill)", fontFamily: "inherit", fontSize: "13px", cursor: "pointer",
            border: `1px solid ${filters.length > 0 ? "var(--border)" : "var(--cognac-soft)"}`,
            background: "transparent",
            color: filters.length > 0 ? "var(--ink-3)" : "var(--cognac-deep)",
          }}
        >
          + Add filter
        </button>
        {showAddMenu && (
          <AddFilterMenu
            existingFields={existingFields}
            onAdd={onAdd}
            onClose={() => setShowAddMenu(false)}
          />
        )}
      </div>
      {filters.length > 0 && (
        <button
          onClick={onClear}
          style={{ fontSize: "10px", color: "var(--ink-4)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
