import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"

// ─────────────────────────────────────────────
// WARM CONCRETE display primitives.
// Three layers, each more precise and less emotional than the last:
// the rank letter (the feeling), the number (the truth), the raw measurement
// (one tap deeper). No progress bars, no gauges, no color-coded heat.
// ─────────────────────────────────────────────

export function Mono({ children, faint, style }: { children: ReactNode; faint?: boolean; style?: CSSProperties }) {
  return (
    <span className={`mono${faint ? " mono-faint" : ""}`} style={style}>
      {children}
    </span>
  )
}

/** The vermillion delta — the eye is trained that vermillion means "changed". */
export function Delta({ value, suffix }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="mono mono-faint">±0{suffix}</span>
  const up = value > 0
  return (
    <span className="mono" style={{ color: "var(--vermillion)", fontSize: 11 }}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {value}
      {suffix}
    </span>
  )
}

/** The confidence band as a thin grey rule beneath the number — not a tooltip.
 * The filled segment is the [lower, upper] interval; the tick is the display
 * value. */
export function ConfidenceRule({
  lower,
  upper,
  display,
  domainMin = 30,
  domainMax = 99,
}: {
  lower: number
  upper: number
  display: number
  domainMin?: number
  domainMax?: number
}) {
  const span = domainMax - domainMin
  const pct = (v: number) => `${((v - domainMin) / span) * 100}%`
  const left = pct(lower)
  const width = `${((upper - lower) / span) * 100}%`
  return (
    <div className="confidence-rule" title={`${lower}–${upper}`}>
      <span style={{ left, width }} />
      <span
        style={{
          left: `calc(${pct(display)} - 1px)`,
          width: 2,
          background: "var(--ink)",
          height: 6,
          top: -2,
        }}
      />
    </div>
  )
}

/** Big rank+number block. `size` in px for the number. */
export function Stat({
  rating,
  display,
  lower,
  upper,
  letter,
  band,
  size = 64,
  delta,
  gated,
}: {
  rating: number
  display?: number
  lower?: number
  upper?: number
  letter: string
  band?: string
  size?: number
  delta?: number
  gated?: boolean
}) {
  const shown = display ?? rating
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span className="rank-letter" style={{ fontSize: size * 0.34, color: gated ? "var(--vermillion)" : "var(--ink-dim)" }}>
          {letter}
        </span>
        <span className="display tabular" style={{ fontSize: size }}>
          {shown}
        </span>
        {delta != null && <Delta value={delta} />}
      </div>
      {lower != null && upper != null && <ConfidenceRule lower={lower} upper={upper} display={shown} />}
      {band && (
        <div style={{ marginTop: 6 }}>
          <Mono faint>{band}</Mono>
        </div>
      )}
    </div>
  )
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0 10px" }}>
      <Mono>{children}</Mono>
      {right}
    </div>
  )
}

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="panel" style={{ padding: 20, ...style }}>
      {children}
    </div>
  )
}

/** A locked-cap warning — the other place vermillion is allowed. */
export function CapNotice({ cap, reason }: { cap: number; reason: string }) {
  return (
    <div style={{ borderLeft: "2px solid var(--vermillion)", paddingLeft: 12, margin: "10px 0" }}>
      <Mono style={{ color: "var(--vermillion)" }}>Cap {cap}</Mono>
      <div style={{ color: "var(--ink-dim)", fontSize: 12, marginTop: 3 }}>{reason}</div>
    </div>
  )
}

export function AttributeLink({
  href,
  label,
  tagline,
  children,
}: {
  href: string
  label: string
  tagline?: string
  children: ReactNode
}) {
  return (
    <Link href={href} className="reveal-row" style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0" }}>
        <div>
          <div className="serif" style={{ fontSize: 18 }}>
            {label}
          </div>
          {tagline && <Mono faint style={{ fontSize: 9 }}>{tagline}</Mono>}
        </div>
        {children}
      </div>
    </Link>
  )
}
