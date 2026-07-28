"use client"

import { useEffect, useState, type DragEvent, type ReactNode } from "react"

const STORAGE_KEY = "life-os-home-widget-order-v1"
const DEFAULT_ORDER = ["schedule", "prepare", "commitments", "nudges"] as const
type WidgetId = typeof DEFAULT_ORDER[number]

const LABELS: Record<WidgetId, string> = {
  schedule: "Today",
  prepare: "Prepare",
  commitments: "Commitments",
  nudges: "Nudges",
}

export default function CustomizableWidgetGrid({
  schedule,
  prepare,
  commitments,
  nudges,
}: {
  schedule: ReactNode
  prepare: ReactNode
  commitments: ReactNode
  nudges: ReactNode
}) {
  const [order, setOrder] = useState<WidgetId[]>([...DEFAULT_ORDER])
  const [draggedId, setDraggedId] = useState<WidgetId | null>(null)
  const widgets: Record<WidgetId, ReactNode> = { schedule, prepare, commitments, nudges }

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as unknown
      if (!Array.isArray(stored)) return
      const valid = stored.filter((id): id is WidgetId => DEFAULT_ORDER.includes(id as WidgetId))
      const missing = DEFAULT_ORDER.filter(id => !valid.includes(id))
      if (valid.length) setOrder([...valid, ...missing])
    } catch {
      // A malformed preference should never prevent Home from rendering.
    }
  }, [])

  function save(next: WidgetId[]) {
    setOrder(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Keep the current session customized even when storage is unavailable.
    }
  }

  function move(id: WidgetId, direction: -1 | 1) {
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    const next = [...order]
    ;[next[from], next[to]] = [next[to], next[from]]
    save(next)
  }

  function dropOn(targetId: WidgetId, event: DragEvent<HTMLElement>) {
    event.preventDefault()
    if (!draggedId || draggedId === targetId) return
    const next = order.filter(id => id !== draggedId)
    next.splice(next.indexOf(targetId), 0, draggedId)
    save(next)
    setDraggedId(null)
  }

  return (
    <section aria-label="Customizable Home widgets">
      <div className="widget-customize-hint">Drag widgets to arrange your Home</div>
      <div className="dashboard-widget-grid">
        {order.map((id, index) => (
          <article
            key={id}
            className={`dashboard-widget-slot${draggedId === id ? " is-dragging" : ""}`}
            onDragOver={event => event.preventDefault()}
            onDrop={event => dropOn(id, event)}
          >
            <div className="widget-move-controls">
              <button
                type="button"
                draggable
                aria-label={`Drag ${LABELS[id]} widget`}
                title={`Drag ${LABELS[id]}`}
                onDragStart={event => {
                  setDraggedId(id)
                  event.dataTransfer.effectAllowed = "move"
                  event.dataTransfer.setData("text/plain", id)
                }}
                onDragEnd={() => setDraggedId(null)}
              >
                ⠿
              </button>
              <button
                type="button"
                aria-label={`Move ${LABELS[id]} earlier`}
                disabled={index === 0}
                onClick={() => move(id, -1)}
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`Move ${LABELS[id]} later`}
                disabled={index === order.length - 1}
                onClick={() => move(id, 1)}
              >
                →
              </button>
            </div>
            {widgets[id]}
          </article>
        ))}
      </div>
    </section>
  )
}
