"use client"

import { formatInteger } from "@/lib/format"

export type LayerId = "location" | "finance" | "photos" | "interactions" | "enrichment"

export type LayerConfig = {
  id: LayerId
  label: string
  icon: string
  color: string
  count: number
  active: boolean
}

export function LayerPanel({ layers, onToggle }: { layers: LayerConfig[]; onToggle: (id: LayerId) => void }) {
  return (
    <div className="layer-panel" aria-label="Map layers">
      {layers.map(layer => (
        <button
          key={layer.id}
          type="button"
          className="layer-toggle"
          aria-pressed={layer.active}
          aria-label={`${layer.label} layer`}
          title={`${layer.label} layer`}
          onClick={() => onToggle(layer.id)}
          style={{
            borderColor: layer.active ? layer.color : "var(--border)",
            background: layer.active ? "var(--surface)" : "rgba(250, 248, 244, 0.72)",
            color: layer.active ? "var(--ink)" : "var(--ink-3)",
          }}
        >
          <span className="layer-toggle-icon" style={{ background: layer.active ? layer.color : "var(--ink-4)" }}>
            {layer.icon}
          </span>
          <span className="layer-toggle-label">{layer.label}</span>
          <span className="layer-toggle-count">{formatInteger(layer.count)}</span>
        </button>
      ))}
    </div>
  )
}
