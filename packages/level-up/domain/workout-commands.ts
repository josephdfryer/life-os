import { db } from "@life-os/db"
import { loadBundle } from "./profile-store"
import { rateSet, type SetRating } from "../engine/training"
import { effectiveLoadKg } from "./metrics"

// ─────────────────────────────────────────────
// THE WORKOUT WRITE PATH
//
// One rule governs this file: the logging screen must never block on the
// network. Every command here is small, independent, and safe to retry, so a
// client can fire it optimistically and queue on failure.
//
// Callers resolve workspaceId themselves (web via session, device via bearer
// token) and pass it in — this module never resolves access. Web and native
// device ingestion both call these exact functions, per
// docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md: "Do not maintain separate
// behavioral rules for Swift and web."
//
// A native caller may pass `source`/`sourceId` — a stable, client-generated
// identifier — so replay after a partial batch failure or a cross-device
// collision converges instead of duplicating. Replaying the same source ID
// with identical content is a duplicate success; the same ID with different
// content is a conflict requiring explicit correction, never a silent
// overwrite. The web caller omits both; every web-created row is therefore
// exempt from the idempotency table (SQLite treats NULL,NULL as always
// distinct under the unique index).
// ─────────────────────────────────────────────

export class WorkoutCommandError extends Error {
  constructor(
    public readonly code: "conflict" | "not_found",
    message: string,
  ) {
    super(message)
    this.name = "WorkoutCommandError"
  }
}

export type ReadinessSnapshotInput = {
  localDay: string
  engineVersion?: string
  ruleSetVersion?: string
  /** Bounded normalized input values + freshness + source. Synthetic-neutral until M3/M4. */
  inputs: Record<string, unknown>
  formSignal?: Record<string, unknown> | null
  band: "full" | "adjust" | "recover"
  originalPrescriptionHash?: string | null
  suggestedPrescriptionHash?: string | null
  reasonCodes?: string[]
}

/**
 * The neutral snapshot every session gets until HealthKit (M3) and Oura (M4)
 * feed real inputs. Always recommends the original prescription unchanged.
 */
export function neutralReadinessSnapshot(localDay: string): ReadinessSnapshotInput {
  return {
    localDay,
    engineVersion: "v1",
    ruleSetVersion: "v1",
    inputs: { synthetic: true },
    formSignal: null,
    band: "full",
    reasonCodes: ["synthetic_neutral_v1"],
  }
}

export type StartSessionInput = {
  workspaceId: string
  programDayId: string | null
  kneeFlare: boolean
  lumbarFlare: boolean
  readiness?: ReadinessSnapshotInput
  source?: string | null
  sourceId?: string | null
}

export type StartedSession = { id: string; startedAt: string; duplicate: boolean }

export async function startSession(input: StartSessionInput): Promise<StartedSession> {
  const { workspaceId, source = null, sourceId = null } = input

  if (source && sourceId) {
    const existing = await db.levelUpSession.findUnique({
      where: { workspaceId_source_sourceId: { workspaceId, source, sourceId } },
      select: { id: true, startedAt: true, programDayId: true, kneeFlare: true, lumbarFlare: true },
    })
    if (existing) {
      if (
        existing.programDayId !== input.programDayId ||
        existing.kneeFlare !== input.kneeFlare ||
        existing.lumbarFlare !== input.lumbarFlare
      ) {
        throw new WorkoutCommandError(
          "conflict",
          `Session source ID "${sourceId}" was already used to start a different session`,
        )
      }
      return { id: existing.id, startedAt: existing.startedAt.toISOString(), duplicate: true }
    }
  }

  const session = await db.levelUpSession.create({
    data: {
      workspaceId,
      programDayId: input.programDayId,
      kneeFlare: input.kneeFlare,
      lumbarFlare: input.lumbarFlare,
      source,
      sourceId,
      ...(input.readiness
        ? {
            readinessSnapshot: {
              create: {
                workspaceId,
                localDay: input.readiness.localDay,
                engineVersion: input.readiness.engineVersion ?? "v1",
                ruleSetVersion: input.readiness.ruleSetVersion ?? "v1",
                inputs: JSON.stringify(input.readiness.inputs),
                formSignal: input.readiness.formSignal ? JSON.stringify(input.readiness.formSignal) : null,
                band: input.readiness.band,
                originalPrescriptionHash: input.readiness.originalPrescriptionHash ?? null,
                suggestedPrescriptionHash: input.readiness.suggestedPrescriptionHash ?? null,
                reasonCodes: JSON.stringify(input.readiness.reasonCodes ?? []),
              },
            },
          }
        : {}),
    },
    select: { id: true, startedAt: true },
  })
  return { id: session.id, startedAt: session.startedAt.toISOString(), duplicate: false }
}

export type CompleteSessionInput = {
  workspaceId: string
  sessionId: string
  sessionRpe?: number | null
}

export async function completeSession(input: CompleteSessionInput) {
  await db.levelUpSession.updateMany({
    where: { id: input.sessionId, workspaceId: input.workspaceId, endedAt: null },
    data: { endedAt: new Date(), sessionRpe: input.sessionRpe ?? null },
  })
}

export type LogSetInput = {
  workspaceId: string
  sessionId: string
  exerciseId: string
  exerciseKey: string
  catalogKey: string | null
  setIndex: number
  reps: number
  loadKg: number
  durationSec: number | null
  isBodyweight: boolean
  bodyweightKg: number | null
  source?: string | null
  sourceId?: string | null
}

export type LoggedSet = {
  id: string
  rank: number | null
  rankLetter: string | null
  balance: number | null
  balanceLabel: string | null
  suppressedRankReason: string | null
  isPr: boolean
  e1rm: number | null
  duplicate: boolean
}

/**
 * Logs one set and returns the rating feedback for the rest screen.
 *
 * Rating only happens for movements the engine can defend — `catalogKey` is
 * present exactly when a population norm exists. A carry or a plank is stored
 * as honest evidence and rated not at all, which is the invariant that keeps
 * the card credible.
 */
export async function logSet(input: LogSetInput): Promise<LoggedSet> {
  const { workspaceId, source = null, sourceId = null } = input

  if (source && sourceId) {
    const existing = await db.levelUpTrainingSet.findUnique({
      where: { workspaceId_source_sourceId: { workspaceId, source, sourceId } },
      select: {
        id: true, sessionId: true, exerciseId: true, setIndex: true, reps: true, loadKg: true,
        durationSec: true, isBodyweight: true, bodyweightKg: true,
        rank: true, rankLetter: true, balanceResidual: true, isPr: true,
      },
    })
    if (existing) {
      if (
        existing.sessionId !== input.sessionId ||
        existing.exerciseId !== input.exerciseId ||
        existing.setIndex !== input.setIndex ||
        existing.reps !== input.reps ||
        existing.loadKg !== input.loadKg ||
        existing.durationSec !== input.durationSec ||
        existing.isBodyweight !== input.isBodyweight ||
        existing.bodyweightKg !== input.bodyweightKg
      ) {
        throw new WorkoutCommandError(
          "conflict",
          `Set source ID "${sourceId}" was already used to log a different set`,
        )
      }
      return {
        id: existing.id,
        rank: existing.rank,
        rankLetter: existing.rankLetter,
        balance: existing.balanceResidual,
        balanceLabel: null,
        suppressedRankReason: null,
        isPr: existing.isPr,
        e1rm: null,
        duplicate: true,
      }
    }
  }

  let rated: SetRating | null = null
  if (input.catalogKey && input.durationSec === null) {
    const bundle = await loadBundle(workspaceId)
    const [prevBest, prevSession] = await Promise.all([
      db.levelUpTrainingSet.findFirst({
        where: { workspaceId, exerciseKey: input.catalogKey },
        orderBy: { loadKg: "desc" },
        select: { loadKg: true, reps: true },
      }),
      db.levelUpTrainingSet.findFirst({
        where: { workspaceId, exerciseKey: input.catalogKey },
        orderBy: { performedAt: "desc" },
        select: { rank: true },
      }),
    ])
    const previousBestE1RM = prevBest ? prevBest.loadKg * (1 + prevBest.reps / 30) : undefined
    rated = rateSet(
      {
        exerciseKey: input.catalogKey,
        reps: input.reps,
        // A bodyweight movement loads the body plus anything added; the norms
        // are relative-strength, so passing bare added weight would rate a
        // weighted pull-up as if it were nearly free.
        loadKg: effectiveLoadKg({
          loadKg: input.loadKg,
          isBodyweight: input.isBodyweight,
          bodyweightKg: input.bodyweightKg,
        }),
        bodyweightKg: input.bodyweightKg ?? 0,
      },
      {
        anchorE1RMs: bundle.anchorE1RMs,
        previousBestE1RM,
        previousRank: prevSession?.rank ?? null,
        sex: bundle.profile.sex,
      },
    )
  }

  const created = await db.levelUpTrainingSet.create({
    data: {
      workspaceId,
      sessionId: input.sessionId,
      exerciseId: input.exerciseId,
      // exerciseKey stays the engine catalog key when there is one, so rating
      // history keeps joining to the pure catalog rather than to a user row.
      exerciseKey: input.catalogKey ?? input.exerciseKey,
      setIndex: input.setIndex,
      reps: input.reps,
      loadKg: input.loadKg,
      durationSec: input.durationSec,
      isBodyweight: input.isBodyweight,
      bodyweightKg: input.bodyweightKg,
      rank: rated?.rank ?? null,
      rankLetter: rated?.rankLetter ?? null,
      balanceResidual: rated?.balance ?? null,
      isPr: rated?.isPr ?? false,
      source,
      sourceId,
    },
    select: { id: true },
  })

  return {
    id: created.id,
    rank: rated?.rank ?? null,
    rankLetter: rated?.rankLetter ?? null,
    balance: rated?.balance ?? null,
    balanceLabel: rated?.balanceLabel ?? null,
    suppressedRankReason: rated?.suppressedRankReason ?? null,
    isPr: rated?.isPr ?? false,
    e1rm: rated?.e1rm ?? null,
    duplicate: false,
  }
}

export async function logBodyMetric(input: {
  workspaceId: string
  weightKg: number | null
  bodyFatPct: number | null
  musclePct: number | null
}) {
  const { workspaceId } = input
  await db.levelUpBodyMetric.create({
    data: {
      workspaceId,
      weightKg: input.weightKg,
      bodyFatPct: input.bodyFatPct,
      musclePct: input.musclePct,
    },
  })
  // Bodyweight feeds every relative-strength norm in the engine, so the profile
  // follows the log rather than drifting behind it.
  if (input.weightKg !== null) {
    await db.levelUpProfile.updateMany({
      where: { workspaceId },
      data: { bodyweightKg: input.weightKg },
    })
  }
}

export async function saveUnitPreference(input: { workspaceId: string; unit: "lb" | "kg"; microPlates: boolean }) {
  await db.levelUpProfile.updateMany({
    where: { workspaceId: input.workspaceId },
    data: { unitPreference: input.unit, microPlates: input.microPlates },
  })
}
