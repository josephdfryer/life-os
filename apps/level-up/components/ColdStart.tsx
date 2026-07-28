"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { saveProfile, logMeasurements, type MeasurementEntry } from "@/lib/actions"
import { Mono } from "@/components/display"

// A short self-report seeds a provisional card. These land as source
// "self_report" — wide band, lower bound shown, and they can never raise a
// verified ceiling. Only a combine does that. That's the anti-cheat.
const QUICK: Array<{ key: string; label: string; unit: string; relative?: boolean }> = [
  { key: "vertical_cmj", label: "Vertical jump (countermovement, arms)", unit: "in" },
  { key: "pushups_max", label: "Push-ups to failure", unit: "reps" },
  { key: "grip", label: "Grip, best hand", unit: "kg" },
  { key: "vo2max", label: "VO2max (watch estimate is fine)", unit: "ml/kg/min" },
  { key: "single_leg_stance_ec", label: "Single-leg stance, eyes closed", unit: "s" },
  { key: "trap_bar_dl", label: "Trap-bar deadlift, best clean set (1RM est.)", unit: "kg", relative: true },
]

export default function ColdStart() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [birthDate, setBirthDate] = useState("")
  const [sex, setSex] = useState("male")
  const [bw, setBw] = useState("")
  const [height, setHeight] = useState("")
  const [reach, setReach] = useState("")
  const [q, setQ] = useState<Record<string, string>>({})

  function finish() {
    start(async () => {
      await saveProfile({
        birthDate: birthDate || null,
        sex,
        bodyweightKg: bw ? parseFloat(bw) : null,
        heightCm: height ? parseFloat(height) : null,
        standingReachCm: reach ? parseFloat(reach) : null,
        completeColdStart: true,
      })
      const entries: MeasurementEntry[] = []
      for (const item of QUICK) {
        const v = q[item.key]
        if (!v || v.trim() === "") continue
        const value = parseFloat(v)
        if (!Number.isFinite(value)) continue
        entries.push({
          testKey: item.key,
          value,
          bodyweightKg: item.relative ? (bw ? parseFloat(bw) : null) : undefined,
          populationSource: item.relative ? "trained" : "general",
          protocolFlags: item.key === "vo2max" ? { wearable: true } : undefined,
        })
      }
      if (entries.length) await logMeasurements(entries, { source: "self_report" })
      router.push("/")
      router.refresh()
    })
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", paddingBottom: 100 }}>
      <div style={{ padding: "16px 0 24px" }}>
        <h1 className="serif" style={{ fontSize: 40, margin: 0 }}>Make it real</h1>
        <Mono faint>
          You start at C rank — the average adult — before doing anything. A rank is a measurement of what you can
          do, not a reward for using the app. Tell us who to compare you against, then seed a few numbers.
        </Mono>
      </div>

      <div className="panel" style={{ padding: 20 }}>
        <Mono>Profile</Mono>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          <Field label="Date of birth"><input type="date" className="field" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></Field>
          <Field label="Sex (norm selection)">
            <select className="field" value={sex} onChange={(e) => setSex(e.target.value)}>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </Field>
          <Field label="Bodyweight (kg)"><input className="field" inputMode="decimal" value={bw} onChange={(e) => setBw(e.target.value)} /></Field>
          <Field label="Height (cm)"><input className="field" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} /></Field>
          <Field label="Standing reach (cm) — for jump targets"><input className="field" inputMode="decimal" value={reach} onChange={(e) => setReach(e.target.value)} /></Field>
        </div>
      </div>

      <div className="panel" style={{ padding: 20, marginTop: -1 }}>
        <Mono>Quick self-assessment — optional</Mono>
        <div style={{ color: "var(--ink-faint)", fontSize: 12, margin: "6px 0 14px" }}>
          These seed a provisional card. They show a wide band and a lower bound, and they can never raise a verified ceiling — only a combine does that.
        </div>
        {QUICK.map((item) => (
          <div key={item.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={{ fontSize: 13 }}>{item.label}</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input className="field" style={{ width: 100 }} inputMode="decimal" placeholder="—" value={q[item.key] ?? ""} onChange={(e) => setQ((s) => ({ ...s, [item.key]: e.target.value }))} />
              <Mono faint style={{ width: 80 }}>{item.unit}</Mono>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 20 }}>
        <button className="btn" disabled={pending} onClick={finish}>Skip self-assessment</button>
        <button className="btn btn-primary" disabled={pending} onClick={finish}>{pending ? "Saving…" : "Build my card →"}</button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 5 }}><Mono faint style={{ fontSize: 9 }}>{label}</Mono></div>
      {children}
    </div>
  )
}
