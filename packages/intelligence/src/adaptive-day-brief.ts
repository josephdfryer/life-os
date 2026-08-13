import {
  createReviewItem,
  resolveReviewItem,
  getLatestStates,
  writeAuditLog,
  type GraphEventActor,
  type AuditActor,
  type ReviewItemRiskTier,
} from "@life-os/domain"
import type { Prisma } from "@life-os/db"
import type { AdaptiveDayEngineInput, CapacityBand, FixedBlock } from "./adaptive-day-types"
import { generateAdaptiveDayBrief, ADAPTIVE_DAY_RULES_VERSION } from "./adaptive-day-engine"
import { CANDIDATE_START_HOUR, CANDIDATE_END_HOUR, MAX_DAYS_AHEAD, longestFreeWindowMinutes } from "./adaptive-day-scheduling"
import { zonedTimeToUtc, localDayString, addDays } from "./adaptive-day-time"

// Orchestration for docs/ADAPTIVE_DAY_PLAN.md — gathers real inputs, runs
// the pure engine (adaptive-day-engine.ts), persists the result, and
// dual-writes a ReviewItem per actionable intervention, the same
// relationship ReviewItem already has with StagedInteraction/NoteSuggestion/
// calendar reconciliation (packages/domain/calendar-reconciliation.ts is the
// template this follows). Lives here rather than packages/domain because it
// needs both the pure engine (this package) and domain commands/ReviewItem
// (packages/domain, which this package already depends on) — the same
// position life-model-snapshots.ts occupies for Theory/Life Model synthesis.

export class AdaptiveDayError extends Error {
  constructor(message: string, readonly code: "not_found") {
    super(message)
    this.name = "AdaptiveDayError"
  }
}

type Actor = GraphEventActor & AuditActor

// Plan has no estimated-duration field today — a real gap, not something to
// silently model around with a schema change mid-feature. Documented
// simplification: every flexible Plan is treated as this long until Plan
// gains a real estimate field.
const DEFAULT_PLAN_DURATION_MINUTES = 30
const CANDIDATE_TAKE = 5

// ── Read ──────────────────────────────────────────────────────────────────

export async function getOrGenerateTodaysBrief(
  workspaceId: string,
  timezone: string,
  ownerPersonId: string | null,
  actor?: Actor,
) {
  const { db } = await import("@life-os/db")
  const day = localDayString(new Date(), timezone)
  const existing = await db.adaptiveDayBrief.findFirst({ where: { workspaceId, day, status: "current" } })
  if (existing && existing.rulesVersion === ADAPTIVE_DAY_RULES_VERSION) {
    return getBriefWithInterventions(existing.id)
  }
  return generateAndPersistBrief(workspaceId, day, timezone, ownerPersonId, actor)
}

export async function refreshTodaysBrief(
  workspaceId: string,
  timezone: string,
  ownerPersonId: string | null,
  actor?: Actor,
) {
  const day = localDayString(new Date(), timezone)
  return generateAndPersistBrief(workspaceId, day, timezone, ownerPersonId, actor)
}

// Historical days show their preserved brief and outcomes read-only — the
// "current" brief for a past day is its final, authoritative record (past
// days are never auto-regenerated; only "today" is).
export async function listAdaptiveDayBriefs(workspaceId: string, limit = 30) {
  const { db } = await import("@life-os/db")
  const briefs = await db.adaptiveDayBrief.findMany({
    where: { workspaceId, status: "current" },
    orderBy: { day: "desc" },
    take: limit,
    include: { interventions: { orderBy: { rank: "asc" }, include: { outcomes: { orderBy: { createdAt: "desc" } } } } },
  })
  return briefs.map(formatBrief)
}

// ── Accept / edit / dismiss ─────────────────────────────────────────────

export async function acceptAdaptiveIntervention(interventionId: string, workspaceId: string, actor?: Actor) {
  return resolveIntervention(interventionId, workspaceId, "accept", undefined, undefined, actor)
}

export async function editAndAcceptAdaptiveIntervention(
  interventionId: string,
  editedInput: Record<string, unknown>,
  workspaceId: string,
  actor?: Actor,
) {
  return resolveIntervention(interventionId, workspaceId, "edit_and_accept", editedInput, undefined, actor)
}

export async function dismissAdaptiveIntervention(
  interventionId: string,
  workspaceId: string,
  reason?: string,
  actor?: Actor,
) {
  return resolveIntervention(interventionId, workspaceId, "dismiss", undefined, reason, actor)
}

async function resolveIntervention(
  interventionId: string,
  workspaceId: string,
  action: "accept" | "edit_and_accept" | "dismiss",
  editedInput: Record<string, unknown> | undefined,
  reason: string | undefined,
  actor: Actor | undefined,
) {
  const { db } = await import("@life-os/db")
  const intervention = await db.adaptiveIntervention.findFirst({
    where: { id: interventionId, brief: { workspaceId } },
  })
  if (!intervention) throw new AdaptiveDayError("Intervention not found", "not_found")
  if (intervention.status !== "pending") {
    return { status: intervention.status, resultType: intervention.resultType, resultId: intervention.resultId }
  }

  // Accepting/editing runs the stored command via the dual-written
  // ReviewItem — it never re-derives the action. capacity_guidance (and an
  // observe-only workout note) never gets a ReviewItem, since there's
  // nothing to run — those resolve directly.
  if (intervention.reviewItemId) {
    const result = await resolveReviewItem({ id: intervention.reviewItemId, workspaceId, action, editedInput, reason, actor })
    await db.adaptiveIntervention.update({
      where: { id: interventionId },
      data: { status: result.status, resultType: result.resultType, resultId: result.resultId },
    })
    return result
  }

  if (action === "dismiss") {
    await db.adaptiveIntervention.update({ where: { id: interventionId }, data: { status: "dismissed" } })
    return { status: "dismissed" as const, resultType: null, resultId: null }
  }
  await db.adaptiveIntervention.update({
    where: { id: interventionId },
    data: { status: "accepted", resultType: "acknowledged", resultId: interventionId },
  })
  return { status: "accepted" as const, resultType: "acknowledged", resultId: interventionId }
}

// ── Outcomes ─────────────────────────────────────────────────────────────

export type RecordAdaptiveOutcomeInput = {
  source: "passive" | "user_reported"
  outcome: string
  confidence?: number | null
  evidence?: Record<string, unknown> | null
  note?: string | null
}

export async function recordAdaptiveInterventionOutcome(
  interventionId: string,
  input: RecordAdaptiveOutcomeInput,
  workspaceId: string,
  actor?: Actor,
) {
  const { db } = await import("@life-os/db")
  const intervention = await db.adaptiveIntervention.findFirst({
    where: { id: interventionId, brief: { workspaceId } },
    select: { id: true },
  })
  if (!intervention) throw new AdaptiveDayError("Intervention not found", "not_found")
  return db.adaptiveInterventionOutcome.create({
    data: {
      workspaceId,
      interventionId,
      source: input.source,
      outcome: input.outcome,
      confidence: input.confidence ?? null,
      evidence: input.evidence ? JSON.stringify(input.evidence) : null,
      note: input.note ?? null,
      actorType: actor?.type ?? null,
      actorId: actor?.id ?? null,
      actorLabel: actor?.label ?? null,
    },
  })
}

// ── Generation ───────────────────────────────────────────────────────────

async function generateAndPersistBrief(
  workspaceId: string,
  day: string,
  timezone: string,
  ownerPersonId: string | null,
  actor: Actor | undefined,
) {
  const { db } = await import("@life-os/db")
  const engineInput = await gatherEngineInputs(workspaceId, day, timezone, ownerPersonId)
  const result = generateAdaptiveDayBrief(engineInput)

  const briefId = await db.$transaction(async tx => {
    // Refresh (or a rules-version bump) supersedes the prior current brief
    // for this day, and any of its still-pending interventions/ReviewItems —
    // but never touches ones already accepted/dismissed.
    const stale = await tx.adaptiveDayBrief.findFirst({
      where: { workspaceId, day, status: "current" },
      include: { interventions: { where: { status: "pending" }, select: { id: true } } },
    })
    if (stale) {
      await tx.adaptiveDayBrief.update({ where: { id: stale.id }, data: { status: "superseded" } })
      const staleIds = stale.interventions.map(iv => iv.id)
      if (staleIds.length) {
        await tx.adaptiveIntervention.updateMany({ where: { id: { in: staleIds } }, data: { status: "superseded" } })
        await tx.reviewItem.updateMany({
          where: { workspaceId, source: "adaptive_day_brief", sourceId: { in: staleIds }, status: "pending" },
          data: { status: "superseded" },
        })
      }
    }

    const created = await tx.adaptiveDayBrief.create({
      data: {
        workspaceId,
        day,
        timezone,
        rulesVersion: result.rulesVersion,
        capacityBand: result.capacityBand,
        inputSnapshot: JSON.stringify(summarizeInputs(engineInput, result)),
        missingSignals: JSON.stringify(result.missingSignals),
      },
    })
    for (const iv of result.interventions) {
      await tx.adaptiveIntervention.create({
        data: {
          briefId: created.id,
          rank: iv.rank,
          category: iv.category,
          recommendationText: iv.recommendationText,
          reasonCodes: JSON.stringify(iv.reasonCodes),
          evidence: iv.evidence ? JSON.stringify(iv.evidence) : null,
          proposedCommand: iv.proposedCommand ? JSON.stringify(iv.proposedCommand) : null,
          riskTier: iv.riskTier,
        },
      })
    }
    return created.id
  })

  // Dual-write ReviewItems outside the transaction — createReviewItem is
  // already best-effort (swallows its own errors), same rule as
  // packages/domain/audit.ts's writeAuditLog: a proposal that failed to get
  // an index row must never roll back the brief it describes.
  const persisted = await db.adaptiveIntervention.findMany({ where: { briefId }, orderBy: { rank: "asc" } })
  for (const iv of persisted) {
    if (!iv.proposedCommand) continue
    const proposed = JSON.parse(iv.proposedCommand) as { command: string; input: Record<string, unknown> }
    const reviewItem = await createReviewItem({
      workspaceId,
      source: "adaptive_day_brief",
      sourceId: iv.id,
      itemType: iv.category,
      command: proposed.command,
      commandInput: { ...proposed.input, interventionId: iv.id },
      targetType: "AdaptiveIntervention",
      targetId: iv.id,
      evidence: iv.evidence ? (JSON.parse(iv.evidence) as Record<string, unknown>) : null,
      riskTier: iv.riskTier as ReviewItemRiskTier,
    })
    if (reviewItem) {
      await db.adaptiveIntervention.update({ where: { id: iv.id }, data: { reviewItemId: reviewItem.id } })
    }
  }

  await writeAuditLog({
    actor,
    action: "adaptive_day_brief.generate",
    targetType: "adaptiveDayBrief",
    targetId: briefId,
    metadata: { day, capacityBand: result.capacityBand, interventionCount: result.interventions.length },
  })

  return getBriefWithInterventions(briefId)
}

function summarizeInputs(input: AdaptiveDayEngineInput, result: { capacityReasonCodes: string[] }) {
  return {
    capacity: input.capacity,
    unscheduledPlanCount: input.unscheduledPlans.length,
    reschedulablePlanCount: input.reschedulable.length,
    workout: input.workout,
    capacityReasonCodes: result.capacityReasonCodes,
  }
}

async function gatherEngineInputs(
  workspaceId: string,
  day: string,
  timezone: string,
  ownerPersonId: string | null,
): Promise<AdaptiveDayEngineInput> {
  const { db } = await import("@life-os/db")
  const now = new Date()
  const rangeStart = zonedTimeToUtc(day, 0, 0, timezone)
  const rangeEnd = zonedTimeToUtc(addDays(day, MAX_DAYS_AHEAD + 1), 0, 0, timezone)
  const tomorrow = addDays(day, 1)

  const [
    events,
    calendarPlans,
    unscheduled,
    scheduledToday,
    latestStates,
    readinessSnapshot,
    completedToday,
    hasProgramDays,
  ] = await Promise.all([
    db.event.findMany({ where: { workspaceId, start: { gte: rangeStart, lt: rangeEnd } }, select: { start: true, end: true } }),
    db.plan.findMany({
      where: { workspaceId, externalSource: { not: null }, scheduledStart: { gte: rangeStart, lt: rangeEnd } },
      select: { scheduledStart: true, scheduledEnd: true },
    }),
    db.plan.findMany({
      where: { workspaceId, status: "active", scheduledStart: null, externalSource: null },
      orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
      take: CANDIDATE_TAKE,
      select: { id: true, text: true },
    }),
    db.plan.findMany({
      where: {
        workspaceId, status: "active", externalSource: null, fulfilledBy: null, reconciliationStatus: null,
        scheduledStart: { gte: rangeStart, lt: zonedTimeToUtc(tomorrow, 0, 0, timezone) },
      },
      orderBy: { scheduledStart: "asc" },
      take: CANDIDATE_TAKE,
      select: { id: true, text: true, scheduledStart: true, scheduledEnd: true },
    }),
    ownerPersonId
      ? getLatestStates("Person", ownerPersonId, ["energy", "mood", "stress"], workspaceId)
      : Promise.resolve({} as Awaited<ReturnType<typeof getLatestStates>>),
    db.levelUpReadinessSnapshot.findFirst({
      where: { workspaceId, localDay: day },
      orderBy: { snapshotAt: "desc" },
      select: { band: true, inputs: true },
    }),
    db.levelUpSession.findFirst({
      where: { workspaceId, endedAt: { not: null }, startedAt: { gte: rangeStart, lt: zonedTimeToUtc(tomorrow, 0, 0, timezone) } },
      select: { id: true },
    }),
    db.levelUpProgramDay.findFirst({ where: { workspaceId }, select: { id: true } }),
  ])

  const fixedBlocksByDay: Record<string, FixedBlock[]> = {}
  const rawBlocks: FixedBlock[] = [
    ...events.filter((e): e is { start: Date; end: Date } => e.end !== null).map(e => ({ start: e.start, end: e.end })),
    ...calendarPlans
      .filter((p): p is { scheduledStart: Date; scheduledEnd: Date } => p.scheduledStart !== null && p.scheduledEnd !== null)
      .map(p => ({ start: p.scheduledStart, end: p.scheduledEnd })),
  ]
  for (const block of rawBlocks) {
    const key = localDayString(block.start, timezone)
    ;(fixedBlocksByDay[key] ??= []).push(block)
  }

  const todayBlocks = fixedBlocksByDay[day] ?? []
  const candidateStart = zonedTimeToUtc(day, CANDIDATE_START_HOUR, 0, timezone)
  const candidateEnd = zonedTimeToUtc(day, CANDIDATE_END_HOUR, 0, timezone)
  const fixedCommitmentMinutes = todayBlocks.reduce((sum, b) => sum + Math.max(0, (b.end.getTime() - b.start.getTime()) / 60_000), 0)

  let levelUpBand: CapacityBand | null = null
  if (readinessSnapshot) {
    try {
      const parsedInputs = JSON.parse(readinessSnapshot.inputs) as { synthetic?: boolean }
      // Synthetic-neutral readiness is a missing signal, not a real "full" —
      // see docs/ADAPTIVE_DAY_PLAN.md §2 and LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md.
      if (parsedInputs.synthetic !== true) levelUpBand = readinessSnapshot.band as CapacityBand
    } catch {
      // Malformed inputs JSON — treat readiness as unavailable, not an error.
    }
  }

  return {
    day,
    timezone,
    now,
    capacity: {
      levelUpBand,
      fixedCommitmentMinutes,
      longestFreeWindowMinutes: longestFreeWindowMinutes(todayBlocks, candidateStart, candidateEnd),
      fixedBlockCount: todayBlocks.length,
      energy: latestStates.energy?.severity ?? null,
      stress: latestStates.stress?.severity ?? null,
    },
    fixedBlocksByDay,
    unscheduledPlans: unscheduled.map(p => ({ id: p.id, text: p.text, estimatedMinutes: DEFAULT_PLAN_DURATION_MINUTES })),
    reschedulable: scheduledToday
      .filter((p): p is typeof p & { scheduledStart: Date } => p.scheduledStart !== null)
      .map(p => ({
        id: p.id,
        text: p.text,
        estimatedMinutes: p.scheduledEnd
          ? Math.max(15, Math.round((p.scheduledEnd.getTime() - p.scheduledStart.getTime()) / 60_000))
          : DEFAULT_PLAN_DURATION_MINUTES,
        scheduledStart: p.scheduledStart,
        scheduledEnd: p.scheduledEnd ?? new Date(p.scheduledStart.getTime() + DEFAULT_PLAN_DURATION_MINUTES * 60_000),
      })),
    workout: hasProgramDays ? { scheduledToday: !completedToday, levelUpBand } : null,
  }
}

// ── Formatting ───────────────────────────────────────────────────────────

const BRIEF_INCLUDE = {
  interventions: { orderBy: { rank: "asc" as const }, include: { outcomes: { orderBy: { createdAt: "desc" as const } } } },
}

async function getBriefWithInterventions(id: string) {
  const { db } = await import("@life-os/db")
  const brief = await db.adaptiveDayBrief.findUnique({ where: { id }, include: BRIEF_INCLUDE })
  return brief ? formatBrief(brief) : null
}

type BriefRow = Prisma.AdaptiveDayBriefGetPayload<{ include: typeof BRIEF_INCLUDE }>

function formatBrief(brief: BriefRow) {
  return {
    ...brief,
    missingSignals: JSON.parse(brief.missingSignals) as string[],
    interventions: brief.interventions.map(formatIntervention),
  }
}

function formatIntervention(iv: BriefRow["interventions"][number]) {
  return {
    ...iv,
    reasonCodes: JSON.parse(iv.reasonCodes) as string[],
    evidence: iv.evidence ? (JSON.parse(iv.evidence) as Record<string, unknown>) : null,
    proposedCommand: iv.proposedCommand ? (JSON.parse(iv.proposedCommand) as { command: string; input: Record<string, unknown> }) : null,
  }
}
