import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { loadBundle, TIER_LABEL, type BadgeTier } from "@life-os/level-up"
import { Mono } from "@/components/display"

export const dynamic = "force-dynamic"

const TIER_COLOR: Record<BadgeTier, string> = {
  bronze: "#9c6b3f",
  silver: "#9aa0a6",
  gold: "#B8925A",
  hof: "#C4522A",
}

export default async function BadgesPage() {
  const access = await requireLevelUpAccess()
  if (!access) return <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>
  const { card } = await loadBundle(access.workspaceId)
  const sorted = [...card.badges].sort((a, b) => Number(b.unlocked) - Number(a.unlocked))

  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      <div style={{ padding: "24px 0 0" }}>
        <Link href="/" className="mono mono-faint">← Card</Link>
      </div>
      <div style={{ padding: "16px 0 24px" }}>
        <h1 className="serif" style={{ fontSize: 40, margin: 0 }}>Badges</h1>
        <Mono faint>Ratings say how good you are. Badges say how you&apos;re good — each tied to a residual or a hard threshold.</Mono>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {sorted.map((b) => {
          const color = b.tier ? TIER_COLOR[b.tier] : "var(--line-strong)"
          return (
            <div key={b.key} className="panel" style={{ padding: 18, opacity: b.unlocked ? 1 : 0.62 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div className="serif" style={{ fontSize: 20 }}>{b.label}</div>
                <span className="rank-letter" style={{ color, fontSize: 11 }}>
                  {b.tier ? TIER_LABEL[b.tier] : "Locked"}
                </span>
              </div>
              <div style={{ color: "var(--ink-dim)", fontSize: 12, marginTop: 6, minHeight: 34 }}>{b.description}</div>

              <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                {b.criteria.map((c) => (
                  <div key={c.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                    <Mono faint style={{ fontSize: 9 }}>{c.met ? "✓" : "○"} {c.label}</Mono>
                    {c.value && <span className="mono tabular" style={{ fontSize: 10, color: c.met ? "var(--ink)" : "var(--ink-faint)" }}>{c.value}</span>}
                  </div>
                ))}
              </div>

              {b.nextTier && (
                <div style={{ marginTop: 12 }}>
                  {/* Progress is text, not a bar — Warm Concrete forbids gauges. */}
                  <Mono faint style={{ fontSize: 9 }}>
                    {TIER_LABEL[b.nextTier]} progress — {Math.round(b.progress * 100)}%
                  </Mono>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
