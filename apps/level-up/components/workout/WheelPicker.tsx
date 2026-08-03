"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// ─────────────────────────────────────────────
// THE WHEEL
//
// This component is the product. Everything else in the session screen is
// scaffolding around the two seconds it takes to log a set.
//
// It is a native overflow-scroll column with CSS scroll-snap doing the detents.
// That is deliberate: the browser's own scroll physics on iOS are better than
// anything re-implemented in JS on top of touch events, and they keep working
// when the main thread is busy writing the previous set. The cost is that the
// selected value has to be read back out of scrollTop, which is what the
// settle-detection below is for.
//
// Padding rows above and below let the first and last real values reach the
// center band. Without them you could never select 0 or the top of the range.
// ─────────────────────────────────────────────

export type WheelOption = {
  /** Stable identity. `BWT` is a sentinel, not a number. */
  value: string
  /** What shows in the band. */
  label: string
}

const ROW_HEIGHT = 44
const VISIBLE_ROWS = 5
const SETTLE_MS = 90

export default function WheelPicker({
  options,
  value,
  onChange,
  label,
  unit,
  ariaLabel,
}: {
  options: WheelOption[]
  value: string
  onChange: (value: string) => void
  label: string
  unit?: string
  ariaLabel?: string
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const settleTimer = useRef<number | null>(null)
  // The value we last told the parent about. Without this the scroll handler
  // fires onChange for every intermediate row the wheel passes through.
  const committed = useRef(value)
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex(option => option.value === value)),
  )

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior) => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: index * ROW_HEIGHT, behavior })
  }, [])

  // Seed position, and follow the value when the parent changes it (a new
  // exercise pre-seeds the wheel to last session's numbers).
  useEffect(() => {
    const index = options.findIndex(option => option.value === value)
    if (index < 0) return
    committed.current = value
    setActiveIndex(index)
    scrollToIndex(index, "auto")
  }, [value, options, scrollToIndex])

  function handleScroll() {
    const element = scrollRef.current
    if (!element) return
    const index = Math.round(element.scrollTop / ROW_HEIGHT)
    const clamped = Math.min(options.length - 1, Math.max(0, index))
    setActiveIndex(clamped)

    // Report only once the wheel has stopped. Scroll events fire continuously
    // through the flick; committing on each one would write a set's worth of
    // intermediate values into React state for a single gesture.
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      const settled = options[clamped]
      if (settled && settled.value !== committed.current) {
        committed.current = settled.value
        onChange(settled.value)
      }
    }, SETTLE_MS)
  }

  useEffect(() => () => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
  }, [])

  function step(delta: number) {
    const next = Math.min(options.length - 1, Math.max(0, activeIndex + delta))
    scrollToIndex(next, "smooth")
  }

  const pad = Math.floor(VISIBLE_ROWS / 2)

  return (
    <div className="wheel">
      <div className="wheel-label mono">{label}</div>
      <div className="wheel-frame" style={{ height: ROW_HEIGHT * VISIBLE_ROWS }}>
        {/* The selection band: two hairlines, never a filled pill. */}
        <div className="wheel-band" style={{ height: ROW_HEIGHT }} aria-hidden="true" />
        <div
          className="wheel-scroll"
          ref={scrollRef}
          onScroll={handleScroll}
          role="listbox"
          aria-label={ariaLabel ?? label}
          tabIndex={0}
          onKeyDown={event => {
            if (event.key === "ArrowUp") { event.preventDefault(); step(-1) }
            if (event.key === "ArrowDown") { event.preventDefault(); step(1) }
          }}
        >
          <div style={{ height: ROW_HEIGHT * pad }} aria-hidden="true" />
          {options.map((option, index) => {
            const distance = Math.abs(index - activeIndex)
            return (
              <div
                className={distance === 0 ? "wheel-row active" : "wheel-row"}
                key={option.value}
                style={{ height: ROW_HEIGHT, ...dimming(distance) }}
                role="option"
                aria-selected={distance === 0}
              >
                <span className="display wheel-value">{option.label}</span>
              </div>
            )
          })}
          <div style={{ height: ROW_HEIGHT * pad }} aria-hidden="true" />
        </div>
      </div>
      {unit && <div className="wheel-unit mono">{unit}</div>}
    </div>
  )
}

/**
 * Neighbours stay legible but recede, so the eye reads the neighbourhood of the
 * value rather than a single number floating in the dark. Two rows out is the
 * edge of the frame; past that nothing is visible anyway.
 */
function dimming(distance: number): React.CSSProperties {
  if (distance === 0) return { opacity: 1 }
  if (distance === 1) return { opacity: 0.42 }
  if (distance === 2) return { opacity: 0.16 }
  return { opacity: 0.06 }
}
