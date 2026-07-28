"use client"

import { useEffect, useState, type ReactNode } from "react"
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

const STORAGE_KEY = "life-os-home-widget-order-v2"
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
  const [activeId, setActiveId] = useState<WidgetId | null>(null)
  const widgets: Record<WidgetId, ReactNode> = { schedule, prepare, commitments, nudges }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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
    save(arrayMove(order, from, to))
  }

  function startDrag(event: DragStartEvent) {
    setActiveId(event.active.id as WidgetId)
  }

  function finishDrag(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over || active.id === over.id) return
    const from = order.indexOf(active.id as WidgetId)
    const to = order.indexOf(over.id as WidgetId)
    if (from >= 0 && to >= 0) save(arrayMove(order, from, to))
  }

  return (
    <section aria-label="Customizable Home widgets">
      <div className="widget-customize-hint">Hold and drag the six dots to arrange your Home</div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={startDrag}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={finishDrag}
      >
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="dashboard-widget-grid">
            {order.map((id, index) => (
              <SortableWidget
                key={id}
                id={id}
                label={LABELS[id]}
                index={index}
                total={order.length}
                onMove={move}
              >
                {widgets[id]}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
          {activeId ? (
            <div className="widget-drag-outline">
              <span>⠿</span>
              <strong>{LABELS[activeId]}</strong>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  )
}

function SortableWidget({
  id,
  label,
  index,
  total,
  onMove,
  children,
}: {
  id: WidgetId
  label: string
  index: number
  total: number
  onMove: (id: WidgetId, direction: -1 | 1) => void
  children: ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <article
      ref={setNodeRef}
      className={`dashboard-widget-slot${isDragging ? " is-dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 3 : undefined,
      }}
    >
      <div className="widget-move-controls">
        <button
          type="button"
          className="widget-drag-handle"
          aria-label={`Drag ${label} widget`}
          title={`Hold and drag ${label}`}
          {...attributes}
          {...listeners}
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <button
          type="button"
          aria-label={`Move ${label} earlier`}
          disabled={index === 0}
          onClick={() => onMove(id, -1)}
        >
          ←
        </button>
        <button
          type="button"
          aria-label={`Move ${label} later`}
          disabled={index === total - 1}
          onClick={() => onMove(id, 1)}
        >
          →
        </button>
      </div>
      <div className="dashboard-widget-content">{children}</div>
    </article>
  )
}
