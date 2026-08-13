"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireLevelUpAccess } from "@/lib/access"
import {
  loadBundle,
  computeCard,
  rateSet,
  TIER_LABEL,
  type Card,
  type BadgeTier,
  type AttributeKey,
} from "@life-os/level-up"

// ─────────────────────────────────────────────
// WRITE PATH
// Raw measurements in; snapshots + provenance out. The engine is pure, so every
// action here is just: gather → call the engine → persist facts.
// ─────────────────────────────────────────────

async function ws() {
  const access = await requireLevelUpAccess()
  if (!access) throw new Error("No Level Up workspace access")
  return access.workspaceId
}

export type ProfileInput = {
  birthDate?: string | null
  sex?: string
  bodyweightKg?: number | null
  heightCm?: number | null
  standingReachCm?: number | null
  primaryBuild?: string | null
  completeColdStart?: boolean
}

export async function saveProfile(input: ProfileInput) {
  const workspaceId = await ws()
  const data = {
    birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
    sex: input.sex,
    bodyweightKg: input.bodyweightKg ?? undefined,
    heightCm: input.heightCm ?? undefined,
    standingReachCm: input.standingReachCm ?? undefined,
    primaryBuild: input.primaryBuild ?? undefined,
    coldStartCompletedAt: input.completeColdStart ? new Date() : undefined,
  }
  await db.levelUpProfile.upsert({
    where: { workspaceId },
    create: { workspaceId, ...data }, // sex falls back to the schema default "male"
    update: data,
  })
  revalidatePath("/")
}

export async function setPrimaryBuild(buildKey: string) {
  const workspaceId = await ws()
  await db.levelUpProfile.upsert({
    where: { workspaceId },
    create: { workspaceId, primaryBuild: buildKey },
    update: { primaryBuild: buildKey },
  })
  revalidatePath("/")
  revalidatePath("/builds")
}

export type MeasurementEntry = {
  testKey: string
  value: number
  bodyweightKg?: number | null
  populationSource?: string
  protocolFlags?: Record<string, unknown>
  deviceFingerprint?: string
  measuredAt?: string
}

export async function logMeasurements(
  entries: MeasurementEntry[],
  opts: { source?: string; combineId?: string } = {},
) {
  const workspaceId = await ws()
  const source = opts.source ?? "self_report"
  await db.levelUpTestResult.createMany({
    data: entries.map((e) => ({
      workspaceId,
      testKey: e.testKey,
      value: e.value,
      bodyweightKg: e.bodyweightKg ?? null,
      populationSource: e.populationSource ?? "general",
      source,
      combineId: opts.combineId ?? null,
      protocolFlags: e.protocolFlags ? JSON.stringify(e.protocolFlags) : null,
      deviceFingerprint: e.deviceFingerprint ?? null,
      measuredAt: e.measuredAt ? new Date(e.measuredAt) : new Date(),
    })),
  })
  revalidatePath("/")
}

// ── The Combine: the only thing that raises a verified ceiling ──────
export type CombineReveal = {
  before: Record<AttributeKey, number> | null
  after: Record<AttributeKey, number>
  ovrBefore: number | null
  ovrAfter: number
  archetype: { key: string; label: string }
  newBadges: Array<{ label: string; tier: string }>
  capsUnlocked: string[]
}

function ratingMap(card: Card): Record<AttributeKey, number> {
  return card.attributes.reduce((acc, a) => ((acc[a.key] = a.rating), acc), {} as Record<AttributeKey, number>)
}

function serializeSnapshot(card: Card) {
  const ratings = card.attributes.reduce((acc, a) => {
    acc[a.key] = { rating: a.rating, lower: a.lower, upper: a.upper, cap: a.cap, confidence: a.confidence.band }
    return acc
  }, {} as Record<string, unknown>)
  const subRatings = card.attributes.reduce((acc, a) => {
    acc[a.key] = a.subRatings
    return acc
  }, {} as Record<string, unknown>)
  const caps = card.attributes.reduce((acc, a) => {
    if (a.cap != null) acc[a.key] = { cap: a.cap, reason: a.capReason }
    return acc
  }, {} as Record<string, unknown>)
  return {
    ovr: card.ovr,
    ratings: JSON.stringify(ratings),
    subRatings: JSON.stringify(subRatings),
    buildOvrs: JSON.stringify(card.buildOvrs),
    badges: JSON.stringify(card.badges.filter((b) => b.unlocked).map((b) => ({ key: b.key, tier: b.tier }))),
    caps: JSON.stringify(caps),
  }
}

export async function runCombine(
  entries: MeasurementEntry[],
  opts: { label?: string; block?: string } = {},
): Promise<CombineReveal> {
  const workspaceId = await ws()

  // Snapshot the card as it stands BEFORE this combine, for the reveal.
  const before = await loadBundle(workspaceId)
  const priorSnapshot = await db.levelUpRatingSnapshot.findFirst({
    where: { workspaceId },
    orderBy: { computedAt: "desc" },
    select: { caps: true },
  })
  const priorCaps = priorSnapshot ? (JSON.parse(priorSnapshot.caps) as Record<string, unknown>) : {}

  const combine = await db.levelUpCombine.create({
    data: { workspaceId, label: opts.label ?? null, block: opts.block ?? "full" },
  })

  await db.levelUpTestResult.createMany({
    data: entries.map((e) => ({
      workspaceId,
      testKey: e.testKey,
      value: e.value,
      bodyweightKg: e.bodyweightKg ?? null,
      populationSource: e.populationSource ?? "general",
      // A wearable estimate logged during a combine stays tagged "wearable" so it
      // can't raise the Engine ceiling past the gate — provenance over convenience.
      source: e.protocolFlags?.wearable === true ? "wearable" : "combine",
      combineId: combine.id,
      protocolFlags: e.protocolFlags ? JSON.stringify(e.protocolFlags) : null,
      deviceFingerprint: e.deviceFingerprint ?? null,
      measuredAt: e.measuredAt ? new Date(e.measuredAt) : new Date(),
    })),
  })

  await db.levelUpCombine.update({ where: { id: combine.id }, data: { completedAt: new Date() } })

  // Recompute the card WITH the new combine, then freeze it as a snapshot.
  const after = await loadBundle(workspaceId)
  const snap = serializeSnapshot(after.card)
  await db.levelUpRatingSnapshot.create({
    data: { workspaceId, combineId: combine.id, ...snap },
  })

  // Record badge unlock events (first time each tier is earned) for the career.
  const newBadges: Array<{ label: string; tier: string }> = []
  for (const b of after.card.badges) {
    if (!b.unlocked || !b.tier) continue
    const existing = await db.levelUpBadgeUnlock.findUnique({
      where: { workspaceId_badgeKey_tier: { workspaceId, badgeKey: b.key, tier: b.tier } },
    })
    if (!existing) {
      await db.levelUpBadgeUnlock.create({ data: { workspaceId, badgeKey: b.key, tier: b.tier } })
      newBadges.push({ label: b.label, tier: TIER_LABEL[b.tier as BadgeTier] })
    }
  }

  // Caps that were present before and are now gone = unlocked.
  const capsUnlocked: string[] = []
  for (const key of Object.keys(priorCaps)) {
    const stillCapped = after.card.attributes.find((a) => a.key === key)?.cap != null
    if (!stillCapped) capsUnlocked.push(after.card.attributes.find((a) => a.key === key)?.label ?? key)
  }

  revalidatePath("/")
  revalidatePath("/career")

  return {
    before: before.combineCount > 0 || before.card.hasAnyData ? ratingMap(before.card) : null,
    after: ratingMap(after.card),
    ovrBefore: before.combineCount > 0 || before.card.hasAnyData ? before.card.ovr : null,
    ovrAfter: after.card.ovr,
    archetype: after.card.archetype,
    newBadges,
    capsUnlocked,
  }
}

// ── Per-set training log (Part 9) ───────────────────────────────────
export type TrainingSetInput = {
  exerciseKey: string
  reps: number
  loadKg: number
  bodyweightKg: number
  sessionId?: string
}

export async function logTrainingSet(input: TrainingSetInput) {
  const workspaceId = await ws()
  const bundle = await loadBundle(workspaceId)

  const [prevBest, prevSession] = await Promise.all([
    db.levelUpTrainingSet.findFirst({
      where: { workspaceId, exerciseKey: input.exerciseKey },
      orderBy: { loadKg: "desc" },
      select: { loadKg: true, reps: true },
    }),
    db.levelUpTrainingSet.findFirst({
      where: { workspaceId, exerciseKey: input.exerciseKey },
      orderBy: { performedAt: "desc" },
      select: { rank: true },
    }),
  ])
  const previousBestE1RM = prevBest ? prevBest.loadKg * (1 + prevBest.reps / 30) : undefined

  const rated = rateSet(
    { exerciseKey: input.exerciseKey, reps: input.reps, loadKg: input.loadKg, bodyweightKg: input.bodyweightKg },
    { anchorE1RMs: bundle.anchorE1RMs, previousBestE1RM, previousRank: prevSession?.rank ?? null, sex: bundle.profile.sex },
  )

  await db.levelUpTrainingSet.create({
    data: {
      workspaceId,
      sessionId: input.sessionId ?? null,
      exerciseKey: input.exerciseKey,
      reps: input.reps,
      loadKg: input.loadKg,
      bodyweightKg: input.bodyweightKg,
      rank: rated.rank,
      rankLetter: rated.rankLetter,
      balanceResidual: rated.balance,
      isPr: rated.isPr,
    },
  })
  revalidatePath("/train")
  return rated
}

// ── Target builds ───────────────────────────────────────────────────
export async function addTargetBuild(buildKey: string, label: string, targets: Record<string, number>) {
  const workspaceId = await ws()
  await db.levelUpTargetBuild.upsert({
    where: { workspaceId_buildKey: { workspaceId, buildKey } },
    create: { workspaceId, buildKey, label, targets: JSON.stringify(targets), status: "active" },
    update: { label, targets: JSON.stringify(targets), status: "active" },
  })
  revalidatePath("/builds")
}

export async function removeTargetBuild(buildKey: string) {
  const workspaceId = await ws()
  await db.levelUpTargetBuild.deleteMany({ where: { workspaceId, buildKey } })
  revalidatePath("/builds")
}
