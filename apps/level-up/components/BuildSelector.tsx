"use client"

import { useTransition } from "react"
import { setPrimaryBuild } from "@/lib/actions"

export default function BuildSelector({
  builds,
  current,
}: {
  builds: Array<{ key: string; label: string; ovr: number }>
  current: string
}) {
  const [pending, start] = useTransition()
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {builds.map((b) => {
        const active = b.key === current
        return (
          <button
            key={b.key}
            className="btn"
            disabled={pending}
            onClick={() => start(() => setPrimaryBuild(b.key))}
            style={{
              borderColor: active ? "var(--vermillion)" : "var(--line-strong)",
              color: active ? "var(--vermillion)" : "var(--ink-dim)",
              display: "flex",
              gap: 8,
              alignItems: "baseline",
            }}
          >
            <span>{b.label}</span>
            <span className="display" style={{ fontSize: 16 }}>{b.ovr}</span>
          </button>
        )
      })}
    </div>
  )
}
