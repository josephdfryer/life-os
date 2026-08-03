"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireLevelUpAccess } from "@/lib/access"
import { loadBundle } from "@/lib/store"
import { rateSet, type SetRating } from "@/lib/engine/training"
import { effectiveLoadKg } from "./metrics"

// ─────────────────────────────────────────────
// THE WORKOUT WRITE PATH
//
// One rule governs this file: the logging screen must never block on the
// network. Every action here is small, independent, and safe to retry, so the
// client can fire it optimistically and queue on failure. Nothing here reads
// back into the UI's critical path.
// ─────────────────────────────────────────────

async function ws() {
  const access = await requireLevelUpAccess()
  if (!access) throw new Error("No Level Up workspace access")
  return access.workspaceId
}

export async function startSession(input: {
  programDayId: string | null
  kneeFlare: boolean
  lumbarFlare: boolean
}) {
  const workspaceId = await ws()
  const session = await db.levelUpSession.create({
    data: {
      workspaceId,
      programDayId: input.programDayId,
      kneeFlare: input.kneeFlare,
      lumbarFlare: input.lumbarFlare,
    },
    select: { id: true, startedAt: true },
  })
  return { id: session.id, startedAt: session.startedAt.toISOString() }
}

export async function endSession(sessionId: string) {
  const workspaceId = await ws()
  await db.levelUpSession.updateMany({
    where: { id: sessionId, workspaceId, endedAt: null },
    data: { endedAt: new Date() },
  })
  revalidatePath("/train")
}

export type LogSetInput = {
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
  const workspaceId = await ws()

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
  }
}

export async function logBodyMetric(input: {
  weightKg: number | null
  bodyFatPct: number | null
  musclePct: number | null
}) {
  const workspaceId = await ws()
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
  revalidatePath("/body")
}

export async function saveUnitPreference(input: { unit: "lb" | "kg"; microPlates: boolean }) {
  const workspaceId = await ws()
  await db.levelUpProfile.updateMany({
    where: { workspaceId },
    data: { unitPreference: input.unit, microPlates: input.microPlates },
  })
  revalidatePath("/train")
}
