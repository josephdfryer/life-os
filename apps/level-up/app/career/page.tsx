import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { cookies } from "next/headers"
import { resolveTimeZone, TZ_COOKIE } from "@life-os/ui"
import { db } from "@/lib/db"
import { TIER_LABEL, type BadgeTier } from "@life-os/level-up"
import { Mono, Delta } from "@/components/display"
import WarmConcrete from "@/components/WarmConcrete"

export const dynamic = "force-dynamic"

type Event =
  | { kind: "combine"; at: Date; ovr: number; label: string | null; delta: number | null }
  | { kind: "badge"; at: Date; label: string; tier: string }

const BADGE_LABELS: Record<string, string> = {
  quick_first_step: "Quick First Step", second_gear: "Second Gear", springs: "Springs", iron_base: "Iron Base",
  motor: "Motor", fast_recovery: "Fast Recovery", floor_general: "Floor General", unbreakable: "Unbreakable", clutch_engine: "Clutch Engine",
}

export default async function CareerPage() {
  const access = await requireLevelUpAccess()
  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)
  if (!access) {
    return (
      <WarmConcrete>
        <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>
      </WarmConcrete>
    )
  }

  const [snapshots, badges] = await Promise.all([
    db.levelUpRatingSnapshot.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { computedAt: "asc" },
      include: { combine: { select: { label: true } } },
    }),
    db.levelUpBadgeUnlock.findMany({ where: { workspaceId: access.workspaceId }, orderBy: { unlockedAt: "asc" } }),
  ])

  const events: Event[] = []
  let prevOvr: number | null = null
  for (const s of snapshots) {
    events.push({ kind: "combine", at: s.computedAt, ovr: s.ovr, label: s.combine?.label ?? null, delta: prevOvr != null ? s.ovr - prevOvr : null })
    prevOvr = s.ovr
  }
  for (const b of badges) {
    events.push({ kind: "badge", at: b.unlockedAt, label: BADGE_LABELS[b.badgeKey] ?? b.badgeKey, tier: TIER_LABEL[b.tier as BadgeTier] ?? b.tier })
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime())

  const ovrs = snapshots.map((s) => s.ovr)
  const peak = ovrs.length ? Math.max(...ovrs) : null

  return (
    <WarmConcrete>
      <div className="wrap" style={{ paddingBottom: 80 }}>
        <div style={{ padding: "24px 0 0" }}>
          <Link href="/" className="mono mono-faint">← Card</Link>
        </div>
        <div style={{ padding: "16px 0 24px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <h1 className="serif" style={{ fontSize: 40, margin: 0 }}>Career</h1>
            <Mono faint>Every combine, every badge, plotted. The retention mechanic and the thing that matters most in three years.</Mono>
          </div>
          {peak != null && (
            <div style={{ textAlign: "right" }}>
              <span className="display tabular" style={{ fontSize: 40 }}>{peak}</span>
              <div><Mono faint style={{ fontSize: 9 }}>peak OVR</Mono></div>
            </div>
          )}
        </div>

        {events.length === 0 ? (
          <div className="panel" style={{ padding: 24 }}>
            <Mono faint>No combines yet. </Mono>
            <Link href="/combine" style={{ color: "var(--vermillion)" }}><Mono style={{ color: "var(--vermillion)" }}>Run your first combine →</Mono></Link>
          </div>
        ) : (
          <div style={{ borderTop: "1px solid var(--line)" }}>
            {events.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 20, padding: "16px 0", borderBottom: "1px solid var(--line)", alignItems: "baseline" }}>
                <Mono faint style={{ width: 92, flexShrink: 0 }}>{e.at.toLocaleDateString("en-US", { timeZone: tz })}</Mono>
                {e.kind === "combine" ? (
                  <div style={{ display: "flex", justifyContent: "space-between", flex: 1, alignItems: "baseline" }}>
                    <span style={{ fontSize: 15 }}>Combine{e.label ? ` — ${e.label}` : ""}</span>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                      <span className="display tabular" style={{ fontSize: 24 }}>{e.ovr}</span>
                      {e.delta != null && <Delta value={e.delta} />}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", flex: 1, alignItems: "baseline" }}>
                    <span style={{ fontSize: 15 }}>Badge — {e.label}</span>
                    <span className="rank-letter" style={{ color: "var(--gold)", fontSize: 11 }}>{e.tier}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </WarmConcrete>
  )
}
