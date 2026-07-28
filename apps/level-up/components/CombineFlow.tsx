"use client"

import { useState, useTransition } from "react"
import { useTimeZone } from "@life-os/ui"
import Link from "next/link"
import { runCombine, type CombineReveal, type MeasurementEntry } from "@/lib/actions"
import type { CombineGroup } from "@/lib/combine-catalog"
import { Delta, Mono } from "@/components/display"

const ATTR_LABELS: Record<string, string> = {
  strength: "Strength", power: "Power", speed: "Speed", agility: "Agility", engine: "Engine",
  workCapacity: "Work Capacity", mobility: "Mobility", control: "Control", reaction: "Reaction", resilience: "Resilience",
}

export default function CombineFlow({ groups, defaultBodyweight }: { groups: CombineGroup[]; defaultBodyweight: number | null }) {
  const tz = useTimeZone()
  const [values, setValues] = useState<Record<string, string>>({})
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [bw, setBw] = useState<string>(defaultBodyweight ? String(defaultBodyweight) : "")
  const [reveal, setReveal] = useState<CombineReveal | null>(null)
  const [pending, start] = useTransition()

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }))
  const toggle = (k: string) => setFlags((s) => ({ ...s, [k]: !s[k] }))

  const filledCount = Object.values(values).filter((v) => v.trim() !== "").length

  function submit() {
    const bwNum = parseFloat(bw) || null
    const entries: MeasurementEntry[] = []
    for (const g of groups) {
      for (const t of g.tests) {
        const raw = values[t.key]
        if (!raw || raw.trim() === "") continue
        const value = parseFloat(raw)
        if (!Number.isFinite(value)) continue
        const protocolFlags: Record<string, unknown> = {}
        for (const opt of t.protocolOptions) if (flags[`${t.key}:${opt.flag}`]) protocolFlags[opt.flag] = true
        entries.push({
          testKey: t.key,
          value,
          bodyweightKg: t.relative ? bwNum : undefined,
          populationSource: t.relative ? "trained" : "general",
          protocolFlags: Object.keys(protocolFlags).length ? protocolFlags : undefined,
        })
      }
    }
    if (!entries.length) return
    start(async () => {
      const r = await runCombine(entries, { label: new Date().toLocaleDateString("en-US", { timeZone: tz }) })
      setReveal(r)
      window.scrollTo({ top: 0, behavior: "smooth" })
    })
  }

  if (reveal) return <Reveal reveal={reveal} />

  return (
    <div style={{ paddingBottom: 100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "8px 0 24px", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 className="serif" style={{ fontSize: 40, margin: 0 }}>The Human Combine</h1>
          <Mono faint>Enter what you measured. Blanks are fine — a missing input beats a compromised one.</Mono>
        </div>
        <div>
          <Mono faint style={{ fontSize: 9 }}>Bodyweight (kg)</Mono>
          <input className="field" style={{ width: 120 }} inputMode="decimal" value={bw} onChange={(e) => setBw(e.target.value)} />
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.attribute} style={{ marginBottom: 8 }}>
          <div style={{ padding: "16px 0 8px", borderBottom: "1px solid var(--line-strong)" }}>
            <Mono>{g.label}</Mono>
          </div>
          {g.tests.map((t) => (
            <div key={t.key} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14 }}>{t.label}</div>
                  {t.note && <Mono faint style={{ fontSize: 9 }}>{t.note}</Mono>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    className="field"
                    style={{ width: 110 }}
                    inputMode="decimal"
                    placeholder="—"
                    value={values[t.key] ?? ""}
                    onChange={(e) => set(t.key, e.target.value)}
                  />
                  <Mono faint style={{ width: 90 }}>{t.unit}</Mono>
                </div>
              </div>
              {t.protocolOptions.length > 0 && values[t.key] && (
                <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {t.protocolOptions.map((opt) => (
                    <label key={opt.flag} style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                      <input type="checkbox" checked={!!flags[`${t.key}:${opt.flag}`]} onChange={() => toggle(`${t.key}:${opt.flag}`)} />
                      <Mono faint style={{ fontSize: 9 }}>{opt.label}</Mono>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}

      <div style={{ position: "sticky", bottom: 0, background: "var(--concrete)", borderTop: "1px solid var(--line-strong)", padding: "16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Mono faint>{filledCount} event{filledCount === 1 ? "" : "s"} entered</Mono>
        <button className="btn btn-primary" disabled={pending || filledCount === 0} onClick={submit}>
          {pending ? "Computing…" : "Complete Combine →"}
        </button>
      </div>
    </div>
  )
}

function Reveal({ reveal }: { reveal: CombineReveal }) {
  const keys = Object.keys(reveal.after) as Array<keyof typeof reveal.after>
  return (
    <div style={{ paddingBottom: 100, maxWidth: 620, margin: "0 auto" }}>
      <div style={{ textAlign: "center", padding: "40px 0 24px" }}>
        <Mono>Athletic profile updated</Mono>
      </div>

      <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 20, padding: "0 0 8px" }}>
        {reveal.ovrBefore != null && (
          <span className="display tabular" style={{ fontSize: 44, color: "var(--ink-faint)" }}>{reveal.ovrBefore}</span>
        )}
        {reveal.ovrBefore != null && <Mono faint>→</Mono>}
        <span className="display tabular" style={{ fontSize: 96 }}>{reveal.ovrAfter}</span>
        {reveal.ovrBefore != null && <Delta value={reveal.ovrAfter - reveal.ovrBefore} />}
      </div>
      <div style={{ textAlign: "center", marginBottom: 30 }}><Mono faint>OVR</Mono></div>

      <div style={{ borderTop: "1px solid var(--line)" }}>
        {keys.map((k) => {
          const after = reveal.after[k]
          const before = reveal.before?.[k]
          const delta = before != null ? after - before : null
          return (
            <div key={k as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="serif" style={{ fontSize: 18 }}>{ATTR_LABELS[k as string] ?? k}</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                {before != null && <span className="display tabular" style={{ fontSize: 20, color: "var(--ink-faint)" }}>{before}</span>}
                {before != null && <Mono faint>→</Mono>}
                <span className="display tabular" style={{ fontSize: 26 }}>{after}</span>
                {delta != null && delta !== 0 && <Delta value={delta} />}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 28, display: "grid", gap: 14 }}>
        <RevealNote label="Archetype" value={reveal.archetype.label} />
        {reveal.newBadges.map((b) => (
          <RevealNote key={b.label} label="New badge" value={`${b.label} — ${b.tier}`} accent />
        ))}
        {reveal.capsUnlocked.map((c) => (
          <RevealNote key={c} label="Cap unlocked" value={`${c} — ceiling raised`} accent />
        ))}
      </div>

      <div style={{ textAlign: "center", marginTop: 40 }}>
        <Link href="/" className="btn btn-primary">View card</Link>
      </div>
    </div>
  )
}

function RevealNote({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", borderLeft: `2px solid ${accent ? "var(--vermillion)" : "var(--line-strong)"}`, paddingLeft: 12 }}>
      <Mono style={accent ? { color: "var(--vermillion)" } : undefined}>{label}</Mono>
      <span style={{ fontSize: 14 }}>{value}</span>
    </div>
  )
}
