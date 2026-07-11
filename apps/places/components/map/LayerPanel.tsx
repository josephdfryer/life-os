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

export function LayerPanel({
  layers,
  collapsed,
  allActive,
  onToggle,
  onReset,
  onCollapsedChange,
}: {
  layers: LayerConfig[]
  collapsed: boolean
  allActive: boolean
  onToggle: (id: LayerId) => void
  onReset: () => void
  onCollapsedChange: (collapsed: boolean) => void
}) {
  if (collapsed) {
    const activeCount = layers.filter(layer => layer.active).length
    return (
      <button
        type="button"
        className="layer-panel layer-panel-collapsed"
        aria-label="Expand map layers"
        title="Expand map layers"
        onClick={() => onCollapsedChange(false)}
      >
        <span>Layers</span>
        <span className="layer-toggle-count">{activeCount}/{layers.length}</span>
      </button>
    )
  }

  return (
    <div className="layer-panel" aria-label="Map layers">
      <div className="layer-panel-header">
        <span>Layers</span>
        <div className="layer-panel-actions">
          <button
            type="button"
            className="layer-panel-action"
            aria-pressed={allActive}
            onClick={onReset}
          >
            All
          </button>
          <button
            type="button"
            className="layer-panel-action"
            aria-label="Collapse map layers"
            title="Collapse map layers"
            onClick={() => onCollapsedChange(true)}
          >
            −
          </button>
        </div>
      </div>
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
            background: layer.active ? "var(--surface)" : "rgba(250, 248, 244, 0.56)",
            color: layer.active ? "var(--ink)" : "var(--ink-4)",
            opacity: layer.active ? 1 : 0.58,
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
