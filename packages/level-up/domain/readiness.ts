import { db } from "@life-os/db"
import { neutralReadinessSnapshot, type ReadinessSnapshotInput } from "./workout-commands"

const OURA_KEYS = [
  "oura_readiness_score",
  "oura_sleep_score",
  "oura_activity_score",
  "oura_stress_high_seconds",
  "oura_recovery_high_seconds",
  "oura_stress_summary",
] as const

const HEALTHKIT_KEYS = [
  "sleep_total_hours",
  "resting_heart_rate",
  "heart_rate_variability",
] as const

const STRESS_SUMMARY_LABEL: Record<number, string> = { 1: "restored", 2: "normal", 3: "stressful" }

/**
 * Source-priority readiness for Level Up. Oura owns Oura scores.
 * HealthKit owns Apple Health measurements. The two are never averaged.
 * Missing data stays missing. The band stays `full` until shadow mode
 * ends — this assembler records evidence, it does not change prescriptions.
 */
export async function assembleReadinessSnapshot(
  workspaceId: string,
  localDay: string,
): Promise<ReadinessSnapshotInput> {
  const personId = await workspaceOwnerPersonId(workspaceId)
  if (!personId) return neutralReadinessSnapshot(localDay)

  const dayStart = new Date(`${localDay}T00:00:00.000Z`)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const keys = [...OURA_KEYS, ...HEALTHKIT_KEYS]
  const rows = await db.state.findMany({
    where: {
      workspaceId,
      entityType: "Person",
      entityId: personId,
      recordedAt: { gte: dayStart, lt: dayEnd },
      definition: { type: "health_metric", value: { in: [...keys] } },
    },
    orderBy: { recordedAt: "desc" },
    select: { severity: true, source: true, recordedAt: true, definition: { select: { value: true } } },
  })

  const latest = new Map<string, { value: number; source: string | null; recordedAt: Date }>()
  for (const row of rows) {
    if (row.severity == null || latest.has(row.definition.value)) continue
    latest.set(row.definition.value, { value: row.severity, source: row.source, recordedAt: row.recordedAt })
  }

  const ouraReadiness = take(latest, "oura_readiness_score", "oura")
  const ouraSleep = take(latest, "oura_sleep_score", "oura")
  const ouraActivity = take(latest, "oura_activity_score", "oura")
  const ouraStressHigh = take(latest, "oura_stress_high_seconds", "oura")
  const ouraRecoveryHigh = take(latest, "oura_recovery_high_seconds", "oura")
  const ouraStressSummary = take(latest, "oura_stress_summary", "oura")
  const healthkitSleep = take(latest, "sleep_total_hours", "healthkit")
  const healthkitRhr = take(latest, "resting_heart_rate", "healthkit")
  const healthkitHrv = take(latest, "heart_rate_variability", "healthkit")

  if (!ouraReadiness) return neutralReadinessSnapshot(localDay)

  const missing: string[] = []
  if (!ouraSleep) missing.push("oura_sleep_score")
  if (!ouraActivity) missing.push("oura_activity_score")
  if (!healthkitSleep) missing.push("sleep_total_hours")
  if (!healthkitRhr) missing.push("resting_heart_rate")
  if (!healthkitHrv) missing.push("heart_rate_variability")

  return {
    localDay,
    engineVersion: "v1",
    ruleSetVersion: "v1",
    inputs: {
      synthetic: false,
      sources: {
        readiness: "oura",
        sleepScore: ouraSleep ? "oura" : null,
        activityScore: ouraActivity ? "oura" : null,
        sleepHours: healthkitSleep ? "healthkit" : null,
        restingHeartRate: healthkitRhr ? "healthkit" : null,
        hrv: healthkitHrv ? "healthkit" : null,
      },
      oura: {
        readinessScore: ouraReadiness.value,
        sleepScore: ouraSleep?.value ?? null,
        activityScore: ouraActivity?.value ?? null,
        stressHighSeconds: ouraStressHigh?.value ?? null,
        recoveryHighSeconds: ouraRecoveryHigh?.value ?? null,
        stressSummary: ouraStressSummary ? STRESS_SUMMARY_LABEL[ouraStressSummary.value] ?? null : null,
      },
      healthkit: {
        sleepTotalHours: healthkitSleep?.value ?? null,
        restingHeartRate: healthkitRhr?.value ?? null,
        heartRateVariability: healthkitHrv?.value ?? null,
      },
      missing,
    },
    formSignal: null,
    band: "full",
    reasonCodes: ["oura_shadow_v1"],
  }
}

function take(
  latest: Map<string, { value: number; source: string | null; recordedAt: Date }>,
  key: string,
  requiredSource: string,
) {
  const row = latest.get(key)
  if (!row || row.source !== requiredSource) return null
  return row
}

async function workspaceOwnerPersonId(workspaceId: string) {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerUserId: true, members: { where: { status: "active" }, orderBy: { createdAt: "asc" }, take: 1, select: { userId: true } } },
  })
  const userId = workspace?.ownerUserId ?? workspace?.members[0]?.userId
  return userId ? (await db.user.findUnique({ where: { id: userId }, select: { personId: true } }))?.personId ?? null : null
}
