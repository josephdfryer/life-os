import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { requireLevelUpAccess } from "@/lib/access"
import { Mono } from "@/components/display"
import ExerciseFigure from "@/components/workout/ExerciseFigure"
import WarmConcrete from "@/components/WarmConcrete"
import { ART_CREDIT } from "@/lib/workout/art"
import {
  loadWorkoutProfile,
  bestE1RMKg,
  e1rmTrend,
  effectiveLoadKg,
  sparklinePath,
  topSetKg,
  totalDurationSec,
  totalVolumeKg,
  type SetRecord,
} from "@life-os/level-up"
import { formatDuration, formatLoad, fromKg } from "@/lib/workout/units"

// ─────────────────────────────────────────────
// EXERCISE DETAIL
//
// Four things: prescription, one trend, one stat block, the logs. The brief is
// explicit that a fifth would start the drift into a dashboard, and it is right
// — this screen exists to answer "is this going up", not to be browsed.
// ─────────────────────────────────────────────

export const dynamic = "force-dynamic"

const SPARK_WIDTH = 320
const SPARK_HEIGHT = 76

export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  const access = await requireLevelUpAccess()
  if (!access) {
    return (
      <WarmConcrete>
        <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>
      </WarmConcrete>
    )
  }

  const { key } = await params
  const exercise = await db.levelUpExercise.findFirst({
    where: { workspaceId: access.workspaceId, key },
    select: {
      id: true, key: true, label: true, modality: true, catalogKey: true, defaultRestSec: true,
      entries: {
        take: 1,
        select: { targetSets: true, targetReps: true, targetDurationSec: true },
      },
    },
  })
  if (!exercise) notFound()

  const [rows, profile] = await Promise.all([
    db.levelUpTrainingSet.findMany({
      where: { workspaceId: access.workspaceId, exerciseId: exercise.id },
      orderBy: { performedAt: "desc" },
      take: 400,
      select: {
        loadKg: true, reps: true, durationSec: true, isBodyweight: true,
        bodyweightKg: true, performedAt: true, sessionId: true, rank: true,
      },
    }),
    loadWorkoutProfile(access.workspaceId),
  ])

  const sets: SetRecord[] = rows.map(row => ({
    loadKg: row.loadKg,
    reps: row.reps,
    durationSec: row.durationSec,
    isBodyweight: row.isBodyweight,
    bodyweightKg: row.bodyweightKg,
    performedAt: row.performedAt,
  }))

  const isTimed = exercise.modality === "duration"
  const trend = e1rmTrend(sets)
  const path = sparklinePath(trend, SPARK_WIDTH, SPARK_HEIGHT)
  const best = bestE1RMKg(sets)
  const top = topSetKg(sets)
  const sessionCount = new Set(rows.map(row => row.sessionId).filter(Boolean)).size
  const prescription = exercise.entries[0]

  // Group the log by session, newest first, so the history reads as trips to
  // the gym rather than an undifferentiated wall of sets.
  const bySession = new Map<string, { performedAt: Date; sets: typeof rows }>()
  for (const row of rows) {
    const groupKey = row.sessionId ?? row.performedAt.toISOString()
    const group = bySession.get(groupKey)
    if (group) group.sets.push(row)
    else bySession.set(groupKey, { performedAt: row.performedAt, sets: [row] })
  }

  const display = (kg: number) => `${formatLoad(Math.round(fromKg(kg, profile.unit) * 10) / 10)} ${profile.unit}`

  return (
    <WarmConcrete>
    <div className="wrap">
      <div className="detail-shell">
        <div style={{ marginBottom: 18 }}>
          <Link href="/train" className="mono">← Train</Link>
        </div>

        <div className="detail-header">
          <h1>{exercise.label}</h1>
          <div className="detail-prescription">
            {prescription
              ? isTimed
                ? `${prescription.targetSets} sets × ${formatDuration(prescription.targetDurationSec ?? 45)}`
                : `${prescription.targetSets} sets × ${prescription.targetReps ?? 5} reps`
              : "Not in the current program"}
            {!exercise.catalogKey && " · balance only"}
          </div>
          {/* Part of the header's identity, not a fifth section — the screen
              still holds prescription, trend, progress, logs. */}
          <ExerciseFigure exerciseKey={exercise.key} label={exercise.label} />
        </div>

        <section className="detail-section">
          <div className="mono">Trend — estimated 1RM</div>
          {path ? (
            <>
              <svg
                className="sparkline"
                viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Estimated 1RM across ${trend.length} sessions`}
              >
                <path d={path} />
              </svg>
              <div className="sparkline-axis">
                <span>{trend[0].day}</span>
                <span>{display(trend[trend.length - 1].valueKg)}</span>
              </div>
            </>
          ) : (
            <div className="empty-note">
              {isTimed
                ? "Timed work has no 1RM to trend."
                : "Two sessions are needed before a trend means anything."}
            </div>
          )}
        </section>

        <section className="detail-section">
          <div className="mono">Progress</div>
          <div className="stat-grid">
            <div className="stat-cell">
              <strong>{sessionCount}</strong>
              <span>Times logged</span>
            </div>
            <div className="stat-cell">
              <strong>{rows.length}</strong>
              <span>Total sets</span>
            </div>
            {isTimed ? (
              <div className="stat-cell">
                <strong>{Math.round(totalDurationSec(sets) / 60)}</strong>
                <span>Total minutes</span>
              </div>
            ) : (
              <div className="stat-cell">
                <strong>{Math.round(fromKg(totalVolumeKg(sets), profile.unit)).toLocaleString()}</strong>
                <span>Total volume {profile.unit}</span>
              </div>
            )}
            <div className="stat-cell">
              <strong>{best ? formatLoad(Math.round(fromKg(best, profile.unit))) : "—"}</strong>
              <span>Best e1RM {profile.unit}</span>
            </div>
          </div>
          {top !== null && (
            <div className="mono mono-faint" style={{ marginTop: 10 }}>
              Heaviest single set {display(top)}
            </div>
          )}
        </section>

        <section className="detail-section">
          <div className="mono">View logs</div>
          {rows.length === 0 ? (
            <div className="empty-note">Nothing logged yet.</div>
          ) : (
            [...bySession.values()].map(group => (
              <div className="log-row" key={group.performedAt.toISOString()}>
                <span className="log-row-date">
                  {group.performedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <span className="log-row-sets">
                  {group.sets
                    .map(row => (
                      row.durationSec !== null
                        ? formatDuration(row.durationSec)
                        : `${row.isBodyweight && row.loadKg === 0 ? "BWT" : display(effectiveLoadKg(row))} × ${row.reps}`
                    ))
                    .join(" · ")}
                </span>
              </div>
            ))
          )}
        </section>

        <div className="art-credit">
          Figure by{" "}
          <a href={ART_CREDIT.href} target="_blank" rel="noreferrer noopener">{ART_CREDIT.author}</a>
          {" · "}
          <a href={ART_CREDIT.licenseHref} target="_blank" rel="noreferrer noopener">{ART_CREDIT.license}</a>
        </div>
      </div>
    </div>
    </WarmConcrete>
  )
}
