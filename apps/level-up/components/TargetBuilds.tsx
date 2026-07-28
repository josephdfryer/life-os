"use client"

import { useTransition } from "react"
import { addTargetBuild, removeTargetBuild } from "@/lib/actions"
import { Mono } from "@/components/display"

export type TargetView = {
  key: string
  label: string
  blurb?: string
  tracked: boolean
  totalGap: number
  requirements: Record<string, number>
  deltas: Array<{ label: string; current: number; required: number; gap: number }>
}

export default function TargetBuilds({ targets }: { targets: TargetView[] }) {
  const [pending, start] = useTransition()
  return (
    <div style={{ display: "grid", gap: 20 }}>
      {targets.map((t) => (
        <div key={t.key} className="panel" style={{ padding: 20, borderColor: t.tracked ? "var(--vermillion)" : "var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <div className="serif" style={{ fontSize: 22 }}>{t.label}</div>
              {t.blurb && <div style={{ color: "var(--ink-dim)", fontSize: 12, marginTop: 4, maxWidth: 520 }}>{t.blurb}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="display tabular" style={{ fontSize: 30, color: t.totalGap === 0 ? "var(--gold)" : "var(--vermillion)" }}>
                {t.totalGap === 0 ? "✓" : `+${t.totalGap}`}
              </span>
              <div><Mono faint style={{ fontSize: 8 }}>{t.totalGap === 0 ? "achieved" : "points to go"}</Mono></div>
            </div>
          </div>

          <div style={{ marginTop: 16, borderTop: "1px solid var(--line)" }}>
            {t.deltas.map((d) => (
              <div key={d.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
                <span style={{ fontSize: 13 }}>{d.label}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span className="display tabular" style={{ fontSize: 18, color: "var(--ink-dim)" }}>{d.current}</span>
                  <Mono faint>→</Mono>
                  <span className="display tabular" style={{ fontSize: 18 }}>{d.required}</span>
                  {d.gap > 0 && <span className="mono" style={{ color: "var(--vermillion)", fontSize: 10 }}>+{d.gap}</span>}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, textAlign: "right" }}>
            <button
              className="btn"
              disabled={pending}
              style={t.tracked ? {} : { borderColor: "var(--vermillion)", color: "var(--vermillion)" }}
              onClick={() =>
                start(() =>
                  t.tracked ? removeTargetBuild(t.key) : addTargetBuild(t.key, t.label, t.requirements),
                )
              }
            >
              {t.tracked ? "Untrack" : "Track this build"}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
