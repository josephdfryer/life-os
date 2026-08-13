import { db } from "@/lib/db"
import { requireLevelUpAccess } from "@/lib/access"
import { Mono } from "@/components/display"
import BodyMetricForm from "@/components/workout/BodyMetricForm"
import { loadWorkoutProfile } from "@life-os/level-up"
import { formatLoad, fromKg } from "@/lib/workout/units"

export const dynamic = "force-dynamic"

export default async function BodyPage() {
  const access = await requireLevelUpAccess()
  if (!access) return <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>

  const [profile, history] = await Promise.all([
    loadWorkoutProfile(access.workspaceId),
    db.levelUpBodyMetric.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { measuredAt: "desc" },
      take: 30,
      select: { id: true, measuredAt: true, weightKg: true, bodyFatPct: true, musclePct: true },
    }),
  ])

  return (
    <div className="wrap">
      <div className="metric-shell">
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 40, fontWeight: 500, margin: "0 0 6px" }}>
          Body
        </h1>
        <div className="mono mono-faint" style={{ marginBottom: 22 }}>
          Kept apart from the set logger on purpose
        </div>

        <BodyMetricForm unit={profile.unit} />

        <div className="metric-history">
          <div className="mono" style={{ marginBottom: 10 }}>History</div>
          {history.length === 0 ? (
            <div className="empty-note">Nothing logged yet.</div>
          ) : (
            history.map(entry => (
              <div className="log-row" key={entry.id}>
                <span className="log-row-date">
                  {entry.measuredAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <span className="log-row-sets">
                  {[
                    entry.weightKg !== null
                      ? `${formatLoad(Math.round(fromKg(entry.weightKg, profile.unit) * 10) / 10)} ${profile.unit}`
                      : null,
                    entry.bodyFatPct !== null ? `${entry.bodyFatPct}% fat` : null,
                    entry.musclePct !== null ? `${entry.musclePct}% muscle` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
