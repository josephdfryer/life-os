"use client"

import { formatInteger } from "@/lib/format"

export type MapViewId = "places" | "density" | "unresolved"
export type EnrichmentId = "people" | "photos" | "spending"

export type MapViewConfig = {
  id: MapViewId
  label: string
  count: number
}

export type EnrichmentConfig = {
  id: EnrichmentId
  label: string
  count: number
  color: string
}

export function LayerPanel({
  views,
  activeView,
  enrichments,
  activeEnrichments,
  collapsed,
  onViewChange,
  onEnrichmentToggle,
  onCollapsedChange,
}: {
  views: MapViewConfig[]
  activeView: MapViewId
  enrichments: EnrichmentConfig[]
  activeEnrichments: Set<EnrichmentId>
  collapsed: boolean
  onViewChange: (id: MapViewId) => void
  onEnrichmentToggle: (id: EnrichmentId) => void
  onCollapsedChange: (collapsed: boolean) => void
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        className="layer-panel layer-panel-collapsed"
        aria-label="Expand map display controls"
        title="Expand map display controls"
        onClick={() => onCollapsedChange(false)}
      >
        <span>{views.find(view => view.id === activeView)?.label ?? "Map view"}</span>
        {activeEnrichments.size ? <span className="layer-toggle-count">+{activeEnrichments.size}</span> : null}
      </button>
    )
  }

  return (
    <div className="layer-panel" aria-label="Map display controls">
      <div className="layer-panel-header">
        <span>Map view</span>
        <button
          type="button"
          className="layer-panel-action"
          aria-label="Collapse map display controls"
          title="Collapse map display controls"
          onClick={() => onCollapsedChange(true)}
        >
          −
        </button>
      </div>

      <div className="layer-panel-group" aria-label="Base map view">
        {views.map(view => (
          <button
            key={view.id}
            type="button"
            className="layer-toggle"
            aria-pressed={activeView === view.id}
            onClick={() => onViewChange(view.id)}
          >
            <span className={`layer-toggle-radio${activeView === view.id ? " is-active" : ""}`} />
            <span className="layer-toggle-label">{view.label}</span>
            <span className="layer-toggle-count">{formatInteger(view.count)}</span>
          </button>
        ))}
      </div>

      {enrichments.length ? (
        <>
          <div className="layer-panel-subtitle">Show on places</div>
          <div className="layer-panel-group" aria-label="Place enrichments">
            {enrichments.map(enrichment => {
              const active = activeEnrichments.has(enrichment.id)
              return (
                <button
                  key={enrichment.id}
                  type="button"
                  className="layer-toggle"
                  aria-pressed={active}
                  onClick={() => onEnrichmentToggle(enrichment.id)}
                >
                  <span
                    className={`layer-toggle-check${active ? " is-active" : ""}`}
                    style={{ "--layer-color": enrichment.color } as React.CSSProperties}
                  >
                    {active ? "✓" : ""}
                  </span>
                  <span className="layer-toggle-label">{enrichment.label}</span>
                  <span className="layer-toggle-count">{formatInteger(enrichment.count)}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}
