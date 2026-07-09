"use client"

import { useState } from "react"
import { relativeTime, parseJsonArray } from "@/lib/utils"
import type { Interaction } from "@/types"

type Props = {
  interaction: Interaction
  onDelete?: () => void
}

const WEIGHT_COLORS: Record<string, string> = {
  Energizing: "#3a8a5c",
  Positive: "#2a6ea3",
  Neutral: "#8a8680",
  Draining: "#a38a3a",
  Stressful: "#a33a2a",
}

const OUTCOME_COLORS: Record<string, string> = {
  Complete: "#3a8a5c",
  "Follow-up needed": "#a38a3a",
  "Action required": "var(--cognac)",
  Open: "#2a6ea3",
}

const TYPE_ICONS: Record<string, string> = {
  call: "↗",
  meeting: "⊡",
  message: "→",
  email: "✉",
  dinner: "◉",
  "in-person": "⊕",
  other: "·",
}

export default function InteractionCard({ interaction, onDelete }: Props) {
  const actionItems = parseJsonArray(interaction.actionItems as unknown as string)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm("Delete this interaction? This cannot be undone.")) return
    setDeleting(true)
    await fetch(`/api/interactions/${interaction.id}`, { method: "DELETE" })
    onDelete?.()
  }

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      padding: "14px 16px",
      opacity: deleting ? 0.5 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
        <span style={{
          width: "26px",
          height: "26px",
          borderRadius: "6px",
          background: "var(--surface2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "12px",
          color: "var(--ink-2)",
          flexShrink: 0,
        }}>
          {TYPE_ICONS[interaction.type] ?? "·"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--ink)", textTransform: "capitalize" }}>
              {interaction.type}
            </span>
            {interaction.duration && (
              <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>
                {interaction.duration}m
              </span>
            )}
            {interaction.emotionalWeight && (
              <span style={{
                fontSize: "10px",
                color: WEIGHT_COLORS[interaction.emotionalWeight] ?? "var(--ink-3)",
              }}>
                {interaction.emotionalWeight}
              </span>
            )}
            {interaction.outcome && (
              <span style={{
                fontSize: "10px",
                color: OUTCOME_COLORS[interaction.outcome] ?? "var(--ink-3)",
                marginLeft: "auto",
              }}>
                {interaction.outcome}
              </span>
            )}
          </div>
        </div>
        <span style={{ fontSize: "11px", color: "var(--ink-4)", flexShrink: 0 }}>
          {relativeTime(interaction.timestamp)}
        </span>
        {onDelete && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Delete interaction"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--ink-4)",
              fontSize: "14px",
              lineHeight: 1,
              padding: "0 2px",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      {interaction.summary && (
        <p style={{ margin: "0 0 6px", fontSize: "12px", color: "var(--ink-2)", lineHeight: 1.5 }}>
          {interaction.summary}
        </p>
      )}

      {interaction.notes && (
        <p style={{ margin: "0 0 6px", fontSize: "11px", color: "var(--ink-3)", lineHeight: 1.5 }}>
          {interaction.notes}
        </p>
      )}

      {actionItems.length > 0 && (
        <div style={{ marginTop: "8px" }}>
          <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Action items</div>
          {actionItems.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: "6px", alignItems: "flex-start", marginBottom: "2px" }}>
              <span style={{ color: "var(--accent)", fontSize: "10px", marginTop: "2px" }}>→</span>
              <span style={{ fontSize: "11px", color: "var(--ink-2)" }}>{item}</span>
            </div>
          ))}
        </div>
      )}

      {interaction.sourceFile && (
        <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--border)" }}>
          <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>
            Imported from:{" "}
            <span style={{ color: "var(--ink-3)" }}>{interaction.sourceFile.filename}</span>
          </span>
        </div>
      )}
    </div>
  )
}
