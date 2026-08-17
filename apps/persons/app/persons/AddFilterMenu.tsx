"use client"

import { useEffect, useRef, useState } from "react"
import { FIELD_DEFS, FIELD_ORDER, PRESENCE_OPERATORS, newFilterId, type Filter, type FilterField } from "@/lib/filters"
import { MobileFilterSheet } from "./MobileFilterSheet"

const GROUP_LABELS: Record<string, string> = { organize: "Organize", details: "Details", fields: "Fields" }
const GROUP_ORDER = ["organize", "details", "fields"] as const

function useIsMobile(breakpoint = 720) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    setIsMobile(mql.matches)
    const listener = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener("change", listener)
    return () => mql.removeEventListener("change", listener)
  }, [breakpoint])
  return isMobile
}

export function AddFilterMenu({
  existingFields,
  onAdd,
  onClose,
}: {
  existingFields: FilterField[]
  onAdd: (filter: Filter) => void
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const [pickedField, setPickedField] = useState<FilterField | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isMobile) return
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [isMobile, onClose])

  const body = pickedField
    ? <ValueStep field={pickedField} onBack={() => setPickedField(null)} onCommit={f => { onAdd(f); onClose() }} />
    : <FieldStep excludeFields={existingFields} onPick={setPickedField} />

  if (isMobile) {
    return (
      <MobileFilterSheet title={pickedField ? FIELD_DEFS[pickedField].label : "Add filter"} onClose={onClose}>
        {body}
      </MobileFilterSheet>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute", zIndex: 30, top: "calc(100% + 8px)", left: 0, width: "280px",
        background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-lg)", padding: "10px",
      }}
    >
      {body}
    </div>
  )
}

function FieldStep({ excludeFields, onPick }: { excludeFields: FilterField[]; onPick: (field: FilterField) => void }) {
  const [query, setQuery] = useState("")
  const available = FIELD_ORDER.filter(f => !excludeFields.includes(f) && FIELD_DEFS[f].label.toLowerCase().includes(query.toLowerCase()))

  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search fields…"
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", marginBottom: "8px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--ink)", fontFamily: "inherit", fontSize: "13px" }}
      />
      <div style={{ maxHeight: "320px", overflowY: "auto" }}>
        {GROUP_ORDER.map(group => {
          const fields = available.filter(f => FIELD_DEFS[f].group === group)
          if (fields.length === 0) return null
          return (
            <div key={group} style={{ marginBottom: "6px" }}>
              <div style={{ fontSize: "10px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 8px" }}>
                {GROUP_LABELS[group]}
              </div>
              {fields.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onPick(f)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 8px", background: "transparent", border: "none", borderRadius: "var(--radius-sm)", color: "var(--ink-2)", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {FIELD_DEFS[f].label}
                </button>
              ))}
            </div>
          )
        })}
        {available.length === 0 && (
          <div style={{ padding: "12px 8px", fontSize: "12px", color: "var(--ink-4)" }}>No matching fields.</div>
        )}
      </div>
    </div>
  )
}

function ValueStep({ field, onBack, onCommit }: { field: FilterField; onBack: () => void; onCommit: (filter: Filter) => void }) {
  const def = FIELD_DEFS[field]
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        style={{ background: "transparent", border: "none", color: "var(--ink-4)", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: 0, marginBottom: "8px" }}
      >
        ← Back
      </button>
      <div style={{ fontSize: "10px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
        {def.label}
      </div>
      {def.kind === "presence" && (
        <div style={{ display: "grid", gap: "6px" }}>
          {PRESENCE_OPERATORS.map(({ operator, label }) => (
            <button
              key={operator}
              type="button"
              onClick={() => onCommit({ id: newFilterId(), field, operator, value: "" })}
              style={{ padding: "9px 12px", textAlign: "left", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--ink-2)", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}
            >
              {def.label} {label}
            </button>
          ))}
        </div>
      )}
      {def.kind === "contains" && <ContainsValueStep field={field} onCommit={onCommit} />}
      {def.kind === "multiselect" && <MultiSelectValueStep field={field} onCommit={onCommit} />}
    </div>
  )
}

function ContainsValueStep({ field, onCommit }: { field: FilterField; onCommit: (filter: Filter) => void }) {
  const [draft, setDraft] = useState("")
  const [suggestions, setSuggestions] = useState<{ value: string; count: number }[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const params = new URLSearchParams({ field, q: draft, limit: "8" })
      const res = await fetch(`/api/persons/facets?${params}`)
      if (!res.ok) return
      const json = await res.json()
      setSuggestions(json.values ?? [])
    }, 150)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [draft, field])

  function commit(value: string) {
    if (!value.trim()) return
    onCommit({ id: newFilterId(), field, operator: "contains", value: value.trim() })
  }

  return (
    <div>
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit(draft) }}
        placeholder={`Start typing…`}
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", marginBottom: "6px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--ink)", fontFamily: "inherit", fontSize: "13px" }}
      />
      {suggestions.length > 0 && (
        <div style={{ maxHeight: "220px", overflowY: "auto" }}>
          {suggestions.map(item => (
            <button
              key={item.value}
              type="button"
              onClick={() => commit(item.value)}
              style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: "10px", padding: "8px", border: "none", background: "transparent", color: "var(--ink-2)", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", textAlign: "left", borderRadius: "var(--radius-sm)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.value}</span>
              <span style={{ color: "var(--ink-4)", flexShrink: 0 }}>{item.count}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        disabled={!draft.trim()}
        onClick={() => commit(draft)}
        style={{ marginTop: "6px", width: "100%", padding: "8px", background: draft.trim() ? "var(--cognac)" : "var(--surface2)", color: draft.trim() ? "#fff" : "var(--ink-4)", border: "none", borderRadius: "var(--radius-sm)", cursor: draft.trim() ? "pointer" : "default", fontFamily: "inherit", fontSize: "12px" }}
      >
        Add filter
      </button>
    </div>
  )
}

function MultiSelectValueStep({ field, onCommit }: { field: FilterField; onCommit: (filter: Filter) => void }) {
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<{ id: string; label: string; count?: number }[]>([])
  const [selected, setSelected] = useState<Map<string, string>>(new Map()) // id/value -> label
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      if (field === "tags") {
        const params = new URLSearchParams({ field: "tags", q: query, limit: "20" })
        const res = await fetch(`/api/persons/facets?${params}`)
        if (!res.ok) return
        const json = await res.json()
        setOptions((json.values ?? []).map((v: { value: string; count: number }) => ({ id: v.value, label: v.value, count: v.count })))
      } else if (field === "group") {
        const params = new URLSearchParams({ search: query, limit: "20" })
        const res = await fetch(`/api/groups?${params}`)
        if (!res.ok) return
        const json = await res.json()
        setOptions((json.groups ?? []).map((g: { id: string; name: string }) => ({ id: g.id, label: g.name })))
      }
    }, 150)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [field, query])

  function toggle(id: string, label: string) {
    setSelected(prev => {
      const next = new Map(prev)
      next.has(id) ? next.delete(id) : next.set(id, label)
      return next
    })
  }

  function commit() {
    if (selected.size === 0) return
    const value = [...selected.keys()]
    const labels = [...selected.values()]
    const fieldLabel = FIELD_DEFS[field].label
    const preview = labels.slice(0, 2).join(", ") + (labels.length > 2 ? ` +${labels.length - 2}` : "")
    onCommit({ id: newFilterId(), field, operator: "is_any_of", value, label: `${fieldLabel}: ${preview}` })
  }

  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={field === "tags" ? "Search tags…" : "Search groups…"}
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", marginBottom: "6px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--ink)", fontFamily: "inherit", fontSize: "13px" }}
      />
      <div style={{ maxHeight: "220px", overflowY: "auto", marginBottom: "8px" }}>
        {options.map(opt => {
          const isChecked = selected.has(opt.id)
          return (
            <label
              key={opt.id}
              style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", cursor: "pointer", borderRadius: "var(--radius-sm)", fontSize: "12px", color: "var(--ink-2)" }}
            >
              <input type="checkbox" checked={isChecked} onChange={() => toggle(opt.id, opt.label)} style={{ accentColor: "var(--cognac)", cursor: "pointer" }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>
              {typeof opt.count === "number" && <span style={{ color: "var(--ink-4)" }}>{opt.count}</span>}
            </label>
          )
        })}
        {options.length === 0 && (
          <div style={{ padding: "10px 8px", fontSize: "12px", color: "var(--ink-4)" }}>
            {field === "tags" ? "No tags found." : "No groups found."}
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={selected.size === 0}
        onClick={commit}
        style={{ width: "100%", padding: "8px", background: selected.size > 0 ? "var(--cognac)" : "var(--surface2)", color: selected.size > 0 ? "#fff" : "var(--ink-4)", border: "none", borderRadius: "var(--radius-sm)", cursor: selected.size > 0 ? "pointer" : "default", fontFamily: "inherit", fontSize: "12px" }}
      >
        Add filter{selected.size > 0 ? ` (${selected.size})` : ""}
      </button>
    </div>
  )
}
