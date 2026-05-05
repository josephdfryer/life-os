"use client"

import { useState } from "react"
import type { ImportedPerson } from "@/types"

type Props = {
  result: ImportedPerson
  index: number
  onChange: (updated: ImportedPerson) => void
}

export default function ResultCard({ result, onChange }: Props) {
  const [expanded, setExpanded] = useState(true)
  const badge = result.needsReview ? "⚠ Review" : result.isNew ? "New" : result.matchedPersonName ? `→ ${result.matchedPersonName}` : "Matched"
  const badgeColor = result.needsReview ? "#a38a3a" : result.isNew ? "#3a8a5c" : "#2a6ea3"
  const badgeBg = result.needsReview ? "#f8f4e8" : result.isNew ? "#e8f4ed" : "#e8f1f8"

  function update(key: keyof ImportedPerson, value: unknown) {
    onChange({ ...result, [key]: value })
  }

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "10px",
      overflow: "hidden",
    }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "14px 16px",
          cursor: "pointer",
          borderBottom: expanded ? "1px solid var(--border)" : "none",
        }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
            <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--ink)" }}>{result.name}</span>
            <span style={{
              fontSize: "10px",
              fontWeight: 500,
              color: badgeColor,
              background: badgeBg,
              padding: "2px 7px",
              borderRadius: "4px",
            }}>
              {badge}
            </span>
          </div>
          {result.guessedHeadline && (
            <div style={{ fontSize: "11px", color: "var(--ink-3)" }}>{result.guessedHeadline}</div>
          )}
        </div>
        <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>
          {result.interactions.length} interaction{result.interactions.length !== 1 ? "s" : ""}
        </div>
        <span style={{ color: "var(--ink-4)", fontSize: "12px" }}>{expanded ? "▾" : "▸"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "16px" }}>
          {result.matchedPersonId ? (
            <div style={{
              padding: "10px 14px",
              background: "#e8f1f8",
              border: "1px solid #b8d4ec",
              borderRadius: "7px",
              marginBottom: "12px",
              fontSize: "12px",
              color: "#2a6ea3",
            }}>
              Interactions will be added to <strong>{result.matchedPersonName}</strong> — no new Person will be created.
            </div>
          ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <Field
              label="Name"
              value={result.name}
              onChange={v => update("name", v)}
            />
            <Field
              label="Headline"
              value={result.guessedHeadline ?? ""}
              onChange={v => update("guessedHeadline", v || null)}
            />
          </div>
          )}

          <div style={{ marginBottom: "12px" }}>
            <label style={labelStyle}>Closeness</label>
            <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
              {([
                [1, "Acquaintance"],
                [2, "Nurture"],
                [3, "Friend"],
                [4, "Inner Circle"],
              ] as [number, string][]).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => update("guessedCloseness", val)}
                  style={{
                    flex: 1,
                    padding: "5px 4px",
                    borderRadius: "5px",
                    border: `1px solid ${result.guessedCloseness === val ? "var(--accent)" : "var(--border)"}`,
                    background: result.guessedCloseness === val ? "var(--accent-soft)" : "var(--surface2)",
                    color: result.guessedCloseness === val ? "var(--accent)" : "var(--ink-3)",
                    fontSize: "10px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
            {result.closenessReason && (
              <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "5px" }}>{result.closenessReason}</div>
            )}
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label style={labelStyle}>Tags</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "6px" }}>
              {result.guessedTags.map(tag => (
                <span key={tag} style={{
                  padding: "3px 8px",
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  fontSize: "11px",
                  color: "var(--ink-2)",
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Interactions ({result.interactions.length})</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
              {result.interactions.map((ix, i) => (
                <div key={i} style={{
                  padding: "10px 12px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "7px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--ink)", textTransform: "capitalize" }}>{ix.eventType}</span>
                    <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{ix.date}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "11px", color: "var(--ink-2)", lineHeight: 1.5 }}>{ix.summary}</p>
                  <div style={{ display: "flex", gap: "8px", marginTop: "5px" }}>
                    <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{ix.emotionalWeight}</span>
                    <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>·</span>
                    <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{ix.outcome}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "7px 10px",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          color: "var(--ink)",
          fontFamily: "inherit",
          fontSize: "12px",
          marginTop: "4px",
        }}
      />
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  color: "var(--ink-3)",
  fontSize: "10px",
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
}
