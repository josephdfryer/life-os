import { db } from "@/lib/db"
import { computeCard, type Card } from "@/lib/engine"
import type { AttributeKey, Profile, TestResultInput } from "@/lib/engine/types"

// ─────────────────────────────────────────────
// THE STORE — the one place the engine meets the database.
// Load raw measurements + history, derive behavioral inputs, and hand a clean
// CardInput to the pure engine. Nothing here decides a rating; it only gathers.
// ─────────────────────────────────────────────

const WEEK = 7 * 24 * 3600 * 1000
const DEFAULT_PROFILE: Profile = {
  birthDate: null,
  sex: "male",
  bodyweightKg: null,
  heightCm: null,
  standingReachCm: null,
  primaryBuild: "general",
  coldStartCompletedAt: null,
}

// Test key → training anchor-lift key (different namespaces on purpose).
const TEST_TO_ANCHOR: Record<string, string> = {
  trap_bar_dl: "trap_bar_deadlift",
  bench_press: "bench_press",
  weighted_pullup: "weighted_pullup",
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export type LoadedProfile = {
  exists: boolean
  coldStartDone: boolean
  profile: Profile
}

export async function loadProfile(workspaceId: string): Promise<LoadedProfile> {
  const row = await db.levelUpProfile.findUnique({ where: { workspaceId } })
  if (!row) return { exists: false, coldStartDone: false, profile: { ...DEFAULT_PROFILE } }
  return {
    exists: true,
    coldStartDone: !!row.coldStartCompletedAt,
    profile: {
      birthDate: row.birthDate ?? null,
      sex: (row.sex as Profile["sex"]) ?? "male",
      bodyweightKg: row.bodyweightKg ?? null,
      heightCm: row.heightCm ?? null,
      standingReachCm: row.standingReachCm ?? null,
      primaryBuild: row.primaryBuild ?? "general",
      coldStartCompletedAt: row.coldStartCompletedAt ?? null,
    },
  }
}

export type StoreBundle = {
  card: Card
  profile: Profile
  profileExists: boolean
  coldStartDone: boolean
  anchorE1RMs: Record<string, number>
  lastCombineAt: Date | null
  combineCount: number
}

export async function loadBundle(workspaceId: string, now = new Date()): Promise<StoreBundle> {
  const [{ profile, exists, coldStartDone }, resultRows, trainingRows, combines, lastSnapshot, targetRows] =
    await Promise.all([
      loadProfile(workspaceId),
      db.levelUpTestResult.findMany({
        where: { workspaceId },
        orderBy: { measuredAt: "desc" },
      }),
      db.levelUpTrainingSet.findMany({
        where: { workspaceId, performedAt: { gte: new Date(now.getTime() - 26 * WEEK) } },
        orderBy: { performedAt: "desc" },
      }),
      db.levelUpCombine.findMany({
        where: { workspaceId, completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        select: { id: true, completedAt: true },
      }),
      db.levelUpRatingSnapshot.findFirst({
        where: { workspaceId },
        orderBy: { computedAt: "desc" },
      }),
      db.levelUpTargetBuild.findMany({ where: { workspaceId, status: "active" } }),
    ])

  const targets = targetRows.length
    ? targetRows.map((t) => ({
        key: t.buildKey,
        label: t.label,
        requirements: parseJson<Partial<Record<AttributeKey, number>>>(t.targets, {}),
      }))
    : undefined

  const results: TestResultInput[] = resultRows.map((r) => ({
    id: r.id,
    testKey: r.testKey,
    value: r.value,
    bodyweightKg: r.bodyweightKg,
    populationSource: (r.populationSource as "general" | "trained") ?? "general",
    source: (r.source as TestResultInput["source"]) ?? "combine",
    measuredAt: r.measuredAt,
    protocolFlags: parseJson<Record<string, unknown> | null>(r.protocolFlags, null),
    deviceFingerprint: r.deviceFingerprint,
  }))

  // Anchor-lift e1RMs (latest value per anchor test) for per-set BALANCE.
  const anchorE1RMs: Record<string, number> = {}
  for (const r of resultRows) {
    const anchor = TEST_TO_ANCHOR[r.testKey]
    if (anchor && !(anchor in anchorE1RMs)) anchorE1RMs[anchor] = r.value
  }

  // Behavioral panel + resilience inputs, from training + combine history.
  const behavioral = deriveBehavioral(trainingRows, combines, now)
  const symmetryRating = deriveSymmetry(resultRows)
  const earliest = [...resultRows, ...trainingRows].reduce<number | null>((min, r) => {
    const t = ("measuredAt" in r ? r.measuredAt : r.performedAt)?.getTime() ?? now.getTime()
    return min == null ? t : Math.min(min, t)
  }, null)
  const hasSixMonthHistory = earliest != null && now.getTime() - earliest >= 26 * WEEK

  const verifiedCeilings = lastSnapshot
    ? parseJson<Record<string, { rating: number }>>(lastSnapshot.ratings, {})
    : {}
  const ceilings: Partial<Record<AttributeKey, number>> = {}
  for (const [k, v] of Object.entries(verifiedCeilings)) {
    if (v && typeof v.rating === "number") ceilings[k as AttributeKey] = v.rating
  }

  const card = computeCard({
    profile,
    results,
    now,
    verifiedCeilings: ceilings,
    resilience: {
      trainingDaysTrailing12wk: behavioral.trainingDays12wk,
      plannedPerWeek: 3,
      hasSixMonthHistory,
      symmetryRating,
      injurySessionsLost: 0,
    },
    behavioral: {
      consistencyPct: behavioral.consistencyPct,
      streakWeeks: behavioral.streakWeeks,
      loadTolerance: behavioral.loadTolerance,
      testDayDelta: behavioral.testDayDelta,
      testDayDeltaStreak: behavioral.testDayDeltaStreak,
      availabilityWeeks: behavioral.availabilityWeeks,
    },
    targets,
  })

  return {
    card,
    profile,
    profileExists: exists,
    coldStartDone,
    anchorE1RMs,
    lastCombineAt: combines[0]?.completedAt ?? null,
    combineCount: combines.length,
  }
}

type TrainingRow = { performedAt: Date; sessionId: string | null; exerciseKey: string; rank: number | null }
type CombineRow = { id: string; completedAt: Date | null }

function deriveBehavioral(training: TrainingRow[], combines: CombineRow[], now: Date) {
  const trailing12 = training.filter((t) => now.getTime() - t.performedAt.getTime() <= 12 * WEEK)
  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const trainingDays12wk = new Set(trailing12.map((t) => dayKey(t.performedAt))).size
  const consistencyPct = Math.min(100, Math.round((trainingDays12wk / (3 * 12)) * 100))

  // Streak: consecutive weeks (back from now) with ≥1 session.
  const weeksWithSession = new Set(
    training.map((t) => Math.floor((now.getTime() - t.performedAt.getTime()) / WEEK)),
  )
  let streakWeeks = 0
  while (weeksWithSession.has(streakWeeks)) streakWeeks++

  const spanWeeks = training.length
    ? Math.ceil((now.getTime() - Math.min(...training.map((t) => t.performedAt.getTime()))) / WEEK)
    : 0

  return {
    trainingDays12wk,
    consistencyPct,
    streakWeeks,
    availabilityWeeks: Math.min(spanWeeks, combines.length ? Math.max(spanWeeks, 1) : spanWeeks),
    loadTolerance: (trainingDays12wk >= 24 ? "building" : trainingDays12wk >= 8 ? "steady" : "unknown") as
      | "building"
      | "steady"
      | "at-risk"
      | "unknown",
    testDayDelta: null as number | null,
    testDayDeltaStreak: 0,
  }
}

function deriveSymmetry(rows: Array<{ testKey: string; value: number; measuredAt: Date }>): number | null {
  const latest = (key: string) =>
    rows
      .filter((r) => r.testKey === key)
      .sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime())[0]?.value ?? null
  const l = latest("knee_to_wall_l")
  const r = latest("knee_to_wall_r")
  if (l == null || r == null) return null
  const delta = Math.abs(l - r)
  return Math.max(30, 75 - delta * 5)
}
