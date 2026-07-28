"use client"

import { useEffect, useState } from "react"
import {
  buildMergeFields,
  initialMergeChoices,
  MERGE_FIELDS,
  type MergeChoice,
  type MergePerson,
} from "@/lib/person-merge"

type Props = {
  primaryId: string
  candidateId: string
  onClose: () => void
  onMerged: (keptId: string) => void
}

export default function MergePersonDialog({
  primaryId,
  candidateId,
  onClose,
  onMerged,
}: Props) {
  const [people, setPeople] = useState<[MergePerson, MergePerson] | null>(null)
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({})
  const [swapped, setSwapped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    params.append("id", primaryId)
    params.append("id", candidateId)

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/persons/merge-preview?${params}`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error("Preview failed")
        const data = await res.json() as { persons: [MergePerson, MergePerson] }
        setPeople(data.persons)
        setChoices(initialMergeChoices(data.persons[0], data.persons[1]))
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          setError("Could not load the comparison. Please try again.")
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [candidateId, primaryId])

  const a = people ? (swapped ? people[1] : people[0]) : null
  const b = people ? (swapped ? people[0] : people[1]) : null

  function swap() {
    setSwapped(current => !current)
    setChoices(current => Object.fromEntries(
      Object.entries(current).map(([key, value]) => [
        key,
        value === "a" ? "b" : value === "b" ? "a" : value,
      ]),
    ))
  }

  function choose(key: string, side: "a" | "b") {
    setChoices(current => {
      if (key !== "notes") return { ...current, [key]: side }
      const value = current[key]
      if (value === "both") return { ...current, [key]: side }
      return { ...current, [key]: value === side ? side : "both" }
    })
  }

  async function merge() {
    if (!a || !b) return
    setMerging(true)
    setError(null)
    try {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keepId: a.id,
          deleteId: b.id,
          fields: buildMergeFields(a, b, choices),
        }),
      })
      if (!res.ok) throw new Error("Merge failed")
      onMerged(a.id)
    } catch {
      setError("Could not merge these people. No records were changed.")
      setMerging(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-compare-title"
      style={overlayStyle}
      onClick={event => event.target === event.currentTarget && !merging && onClose()}
    >
      <div style={dialogStyle}>
        <div style={topBarStyle}>
          <div>
            <h2 id="merge-compare-title" style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "22px", fontWeight: 400, color: "var(--ink)" }}>
              Choose what to keep
            </h2>
            <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: "12px" }}>
              A is kept · B is deleted · select the value you want for each field
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={merging} aria-label="Close merge comparison" style={closeButtonStyle}>×</button>
        </div>

        {loading ? (
          <div style={messageStyle}>Preparing comparison…</div>
        ) : error && (!a || !b) ? (
          <div style={messageStyle} role="alert">{error}</div>
        ) : a && b ? (
          <>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={swap} disabled={merging} style={swapButtonStyle}>⇄ Swap A &amp; B</button>
            </div>

            <div style={headerGridStyle}>
              <div style={fieldHeaderStyle}>Field</div>
              <div style={personHeaderStyle}>{a.first} {a.last}<span style={keptLabelStyle}>A · kept</span></div>
              <div style={personHeaderStyle}>{b.first} {b.last}<span style={deletedLabelStyle}>B · deleted</span></div>
            </div>

            <div style={{ maxHeight: "52vh", overflowY: "auto" }}>
              {MERGE_FIELDS.map(({ key, label, multiline }) => {
                const aValue = displayValue(a[key])
                const bValue = displayValue(b[key])
                if (!aValue && !bValue) return null
                const choice = choices[key] ?? "a"
                return (
                  <div key={key} style={rowGridStyle}>
                    <div style={rowLabelStyle}>
                      {label}
                      {key === "notes" && aValue && bValue ? (
                        <small style={{ display: "block", marginTop: "3px", color: "var(--ink-4)", fontStyle: "italic" }}>
                          {choice === "both" ? "combining both" : "select both to combine"}
                        </small>
                      ) : null}
                    </div>
                    <ChoiceButton
                      value={aValue}
                      active={choice === "a" || choice === "both"}
                      multiline={multiline}
                      onClick={() => choose(key, "a")}
                    />
                    <ChoiceButton
                      value={bValue}
                      active={choice === "b" || choice === "both"}
                      multiline={multiline}
                      onClick={() => choose(key, "b")}
                    />
                  </div>
                )
              })}

              {(["emails", "phones", "tags", "values"] as const).map(key => {
                const merged = [...new Set([...(a[key] ?? []), ...(b[key] ?? [])])]
                if (merged.length === 0) return null
                return (
                  <div key={key} style={{ ...rowGridStyle, gridTemplateColumns: "104px minmax(0, 1fr)" }}>
                    <div style={{ ...rowLabelStyle, textTransform: "capitalize" }}>{key}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                      {merged.map(value => <span key={value} style={pillStyle}>{value}</span>)}
                      <span style={{ color: "var(--ink-4)", fontSize: "10px", alignSelf: "center" }}>combined</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={historyStyle}>
              {a.interactionCount + b.interactionCount} interactions · {a.planCount + b.planCount} plans → all kept under {a.first} {a.last}
            </div>

            <div style={footerStyle}>
              {error ? <p role="alert" style={{ margin: 0, color: "var(--attention)", fontSize: "11px" }}>{error}</p> : <span />}
              <div style={{ display: "flex", gap: "10px" }}>
                <button type="button" onClick={onClose} disabled={merging} style={cancelButtonStyle}>Cancel</button>
                <button type="button" onClick={merge} disabled={merging} style={mergeButtonStyle}>
                  {merging ? "Merging…" : `Merge → Keep ${a.first} ${a.last}`}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function ChoiceButton({
  value,
  active,
  multiline,
  onClick,
}: {
  value: string
  active: boolean
  multiline?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={!value}
      aria-pressed={active}
      onClick={onClick}
      title={value || undefined}
      style={{
        minWidth: 0,
        padding: "10px 12px",
        border: `1.5px solid ${active && value ? "var(--cognac)" : "var(--border)"}`,
        borderRadius: "var(--radius)",
        background: active && value ? "var(--cognac-soft)" : "var(--surface)",
        color: value ? (active ? "var(--cognac-deep)" : "var(--ink-2)") : "var(--ink-4)",
        cursor: value ? "pointer" : "default",
        fontFamily: "inherit",
        fontSize: "12px",
        textAlign: "left",
        opacity: value ? 1 : 0.45,
        whiteSpace: multiline ? "pre-wrap" : "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        wordBreak: multiline ? "break-word" : "normal",
      }}
    >
      {value || "—"}
    </button>
  )
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return ""
  return String(value)
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 120,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  background: "rgba(26, 24, 20, 0.58)",
}

const dialogStyle: React.CSSProperties = {
  width: "min(920px, 100%)",
  maxHeight: "92vh",
  overflow: "hidden",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-lg)",
}

const topBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "20px",
  padding: "20px 22px",
  borderBottom: "1px solid var(--border)",
}

const headerGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "104px minmax(0, 1fr) minmax(0, 1fr)",
  gap: "10px",
  padding: "11px 18px",
  background: "var(--surface-2)",
  borderBottom: "1px solid var(--border)",
}

const rowGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "104px minmax(0, 1fr) minmax(0, 1fr)",
  alignItems: "center",
  gap: "10px",
  padding: "9px 18px",
  borderBottom: "1px solid var(--border-subtle)",
}

const fieldHeaderStyle: React.CSSProperties = { color: "var(--ink-4)", fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase" }
const personHeaderStyle: React.CSSProperties = { minWidth: 0, color: "var(--ink)", fontFamily: "var(--font-display)", fontSize: "16px" }
const keptLabelStyle: React.CSSProperties = { marginLeft: "7px", color: "var(--cognac)", fontFamily: "var(--font-body)", fontSize: "10px" }
const deletedLabelStyle: React.CSSProperties = { marginLeft: "7px", color: "var(--ink-4)", fontFamily: "var(--font-body)", fontSize: "10px" }
const rowLabelStyle: React.CSSProperties = { color: "var(--ink-3)", fontSize: "10px" }
const historyStyle: React.CSSProperties = { padding: "10px 18px", color: "var(--ink-4)", background: "var(--surface-2)", borderTop: "1px solid var(--border)", fontSize: "11px" }
const footerStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", padding: "14px 18px", borderTop: "1px solid var(--border)" }
const messageStyle: React.CSSProperties = { padding: "56px 24px", color: "var(--ink-3)", textAlign: "center", fontSize: "13px" }
const pillStyle: React.CSSProperties = { padding: "3px 9px", color: "var(--ink-2)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", fontSize: "11px" }
const closeButtonStyle: React.CSSProperties = { padding: "0 3px", border: 0, color: "var(--ink-3)", background: "transparent", cursor: "pointer", fontSize: "22px", lineHeight: 1 }
const swapButtonStyle: React.CSSProperties = { padding: "7px 13px", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", color: "var(--ink-3)", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: "11px" }
const cancelButtonStyle: React.CSSProperties = { padding: "9px 17px", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", color: "var(--ink-2)", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" }
const mergeButtonStyle: React.CSSProperties = { padding: "9px 18px", border: "1px solid var(--cognac)", borderRadius: "var(--radius-pill)", color: "#fff", background: "var(--cognac)", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 500 }
