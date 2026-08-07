import type { Prisma } from "@life-os/db"
import type { GraphEventActor } from "./events"
import type { AuditActor } from "./audit"

// The universal review queue. One inbox surface over four previously
// divergent ones (StagedInteraction, NoteSuggestion, ImportStagedVisit,
// calendar reconciliation) — see docs/adr/0002-graph-event-spine.md and
// ~/.claude/plans/serialized-bubbling-pearl.md's Track A4.
//
// Design: a ReviewItem never IS the write. It stores a proposedCommand — a
// named command plus its input — and accepting a ReviewItem means "run this
// command", never "re-derive what to do from the raw content". Each source
// queue's real domain command (acceptStagedInteraction, reviewNoteSuggestion,
// reconcileCalendarPlan, ...) still owns its own table and its own status —
// ReviewItem is a dual-written index over them, not a replacement of them
// (yet). That is why every sync here is best-effort: the legacy table is
// still the system of record during the migration window, so a ReviewItem
// sync failure must never roll back or block the real write it is describing
// — same rule as packages/domain/audit.ts's writeAuditLog.

export type ReviewItemActorContext = { workspaceId: string; actor?: GraphEventActor & AuditActor }

export type ReviewItemCommandResult = { resultType: string; resultId: string | null }

type CommandHandler = (input: Record<string, unknown>, ctx: ReviewItemActorContext) => Promise<ReviewItemCommandResult>
type DismissHandler = (sourceId: string, ctx: ReviewItemActorContext) => Promise<void>

// Adapters register themselves at module load (see note-suggestions.ts and
// staged-interactions.ts) rather than living in one giant switch here, so
// adding a fifth queue later never means editing this file.
const COMMAND_REGISTRY = new Map<string, CommandHandler>()
const DISMISS_REGISTRY = new Map<string, DismissHandler>()

export function registerReviewCommand(name: string, handler: CommandHandler) {
  COMMAND_REGISTRY.set(name, handler)
}

export function registerReviewDismiss(source: string, handler: DismissHandler) {
  DISMISS_REGISTRY.set(source, handler)
}

export class ReviewItemError extends Error {
  code: "not_found" | "validation" | "unsupported_command"
  constructor(message: string, code: "not_found" | "validation" | "unsupported_command") {
    super(message)
    this.name = "ReviewItemError"
    this.code = code
  }
}

export type ReviewItemRiskTier = "observe" | "safe_auto" | "review" | "confirm"

export type CreateReviewItemInput = {
  workspaceId?: string
  source: string
  sourceId: string
  itemType: string
  command: string
  commandInput: Record<string, unknown>
  targetType?: string | null
  targetId?: string | null
  confidence?: number | null
  evidence?: Record<string, unknown> | null
  riskTier?: ReviewItemRiskTier
  priority?: number
}

/**
 * Stage (or refresh the proposal on) a ReviewItem. Upsert on
 * (workspaceId, source, sourceId) — re-staging an already-resolved item
 * refreshes its proposal data but never touches status, so it can never
 * silently resurrect something a human already accepted or dismissed.
 *
 * Best-effort by design: called from each adapter's own create path as a
 * side effect after the real write, and a failure here must never surface as
 * a failure of that write.
 */
export async function createReviewItem(input: CreateReviewItemInput) {
  const { db } = await import("@life-os/db")
  const workspaceId = input.workspaceId ?? "default-workspace"
  const proposedCommand = JSON.stringify({ command: input.command, input: input.commandInput })
  const evidence = input.evidence ? JSON.stringify(input.evidence) : null
  try {
    return await db.reviewItem.upsert({
      where: { workspaceId_source_sourceId: { workspaceId, source: input.source, sourceId: input.sourceId } },
      update: {
        itemType: input.itemType,
        proposedCommand,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        confidence: input.confidence ?? null,
        evidence,
        riskTier: input.riskTier ?? "review",
        priority: input.priority ?? 3,
      },
      create: {
        workspaceId,
        source: input.source,
        sourceId: input.sourceId,
        itemType: input.itemType,
        proposedCommand,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        confidence: input.confidence ?? null,
        evidence,
        riskTier: input.riskTier ?? "review",
        priority: input.priority ?? 3,
      },
    })
  } catch (error) {
    console.warn("[review] failed to create/refresh ReviewItem", input.source, input.sourceId, error)
    return null
  }
}

/**
 * Best-effort status sync for a ReviewItem whose underlying command ran
 * through a path other than resolveReviewItem below — the auto-accept path
 * (a rule resolved the legacy item directly) and legacy routes still calling
 * the old accept/dismiss functions during the dual-write window both funnel
 * through this so the ReviewItem row never silently drifts from the table it
 * indexes.
 */
export async function syncReviewItemStatus(input: {
  source: string
  sourceId: string
  workspaceId?: string
  status: "accepted" | "dismissed" | "superseded"
  resultType?: string | null
  resultId?: string | null
  actor?: GraphEventActor & AuditActor
}) {
  const { db } = await import("@life-os/db")
  const workspaceId = input.workspaceId ?? "default-workspace"
  try {
    await db.reviewItem.updateMany({
      where: { workspaceId, source: input.source, sourceId: input.sourceId, status: "pending" },
      data: {
        status: input.status,
        resolvedAt: new Date(),
        resolvedBy: input.actor?.id ?? null,
        resultType: input.resultType ?? null,
        resultId: input.resultId ?? null,
      },
    })
  } catch (error) {
    console.warn("[review] failed to sync ReviewItem status", input.source, input.sourceId, error)
  }
}

export type ResolveReviewItemInput = {
  id: string
  workspaceId?: string
  action: "accept" | "edit_and_accept" | "dismiss"
  editedInput?: Record<string, unknown>
  reason?: string
  actor?: GraphEventActor & AuditActor
}

export type ResolveReviewItemResult = {
  status: "accepted" | "edited_accepted" | "dismissed" | "superseded" | "failed"
  resultType: string | null
  resultId: string | null
}

/** The three ways to resolve a ReviewItem. Idempotent — resolving an already-resolved item returns its recorded result rather than erroring or re-running the command. */
export async function resolveReviewItem(input: ResolveReviewItemInput): Promise<ResolveReviewItemResult> {
  const { db } = await import("@life-os/db")
  const workspaceId = input.workspaceId ?? "default-workspace"
  const item = await db.reviewItem.findFirst({ where: { id: input.id, workspaceId } })
  if (!item) throw new ReviewItemError("Review item not found", "not_found")

  if (item.status !== "pending") {
    return { status: item.status, resultType: item.resultType, resultId: item.resultId }
  }

  const ctx: ReviewItemActorContext = { workspaceId, actor: input.actor }

  if (input.action === "dismiss") {
    const dismiss = DISMISS_REGISTRY.get(item.source)
    if (dismiss) {
      try {
        await dismiss(item.sourceId, ctx)
      } catch (error) {
        console.warn("[review] source dismiss sync failed, ReviewItem still dismissed", item.source, item.sourceId, error)
      }
    }
    await db.reviewItem.update({
      where: { id: item.id },
      data: {
        status: "dismissed",
        resolvedAt: new Date(),
        resolvedBy: input.actor?.id ?? null,
        evidence: mergeEvidence(item.evidence, input.reason ? { dismissReason: input.reason } : null),
      },
    })
    return { status: "dismissed", resultType: null, resultId: null }
  }

  const proposed = JSON.parse(item.proposedCommand) as { command: string; input: Record<string, unknown> }
  const handler = COMMAND_REGISTRY.get(proposed.command)
  if (!handler) throw new ReviewItemError(`No handler registered for command "${proposed.command}"`, "unsupported_command")

  const commandInput = input.action === "edit_and_accept"
    ? { ...proposed.input, ...input.editedInput }
    : proposed.input

  const result = await handler(commandInput, ctx)
  const status = input.action === "edit_and_accept" ? "edited_accepted" as const : "accepted" as const

  await db.reviewItem.update({
    where: { id: item.id },
    data: {
      status,
      resolvedAt: new Date(),
      resolvedBy: input.actor?.id ?? null,
      resultType: result.resultType,
      resultId: result.resultId,
    },
  })

  return { status, resultType: result.resultType, resultId: result.resultId }
}

export type BulkDismissReviewItemsInput = {
  ids: string[]
  workspaceId?: string
  reason?: string
  actor?: GraphEventActor & AuditActor
}

// Deliberately narrower than single-item review: only a same-source,
// same-itemType group, and only observe/safe_auto risk tiers — review and
// confirm tier items exist precisely because they need individual judgment,
// so a bulk dismiss can never touch them.
export async function bulkDismissReviewItems(input: BulkDismissReviewItemsInput) {
  const { db } = await import("@life-os/db")
  const workspaceId = input.workspaceId ?? "default-workspace"
  const unique = [...new Set(input.ids)]
  const items = await db.reviewItem.findMany({ where: { id: { in: unique }, workspaceId, status: "pending" } })
  if (!items.length) return { processed: 0, skipped: unique.length }

  const [first, ...rest] = items
  const sameGroup = rest.every(item => item.source === first.source && item.itemType === first.itemType)
  if (!sameGroup) throw new ReviewItemError("Bulk dismiss requires every item to share the same source and itemType", "validation")
  if (first.riskTier !== "observe" && first.riskTier !== "safe_auto") {
    throw new ReviewItemError(`Bulk dismiss is not allowed for risk tier "${first.riskTier}"`, "validation")
  }

  const dismiss = DISMISS_REGISTRY.get(first.source)
  if (dismiss) {
    for (const item of items) {
      try {
        await dismiss(item.sourceId, { workspaceId, actor: input.actor })
      } catch (error) {
        console.warn("[review] bulk source dismiss sync failed", first.source, item.sourceId, error)
      }
    }
  }

  const result = await db.reviewItem.updateMany({
    where: { id: { in: items.map(item => item.id) } },
    data: {
      status: "dismissed",
      resolvedAt: new Date(),
      resolvedBy: input.actor?.id ?? null,
      evidence: input.reason ? JSON.stringify({ dismissReason: input.reason }) : undefined,
    },
  })

  return { processed: result.count, skipped: unique.length - result.count }
}

export type ListReviewItemsParams = {
  cursor?: string | null
  limit?: number
  status?: string | null
  source?: string | null
  itemType?: string | null
  riskTier?: string | null
}

function encodeReviewCursor(priority: number, createdAt: Date, id: string): string {
  return Buffer.from(`${priority}|${createdAt.toISOString()}|${id}`, "utf8").toString("base64url")
}

function decodeReviewCursor(cursor: string): { priority: number; createdAt: Date; id: string } {
  let decoded: string
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8")
  } catch {
    throw new ReviewItemError("cursor is not valid base64url", "validation")
  }
  const [priorityRaw, createdAtRaw, id] = decoded.split("|")
  const priority = Number(priorityRaw)
  const createdAt = new Date(createdAtRaw ?? "")
  if (!Number.isFinite(priority) || Number.isNaN(createdAt.getTime()) || !id) {
    throw new ReviewItemError("cursor is malformed", "validation")
  }
  return { priority, createdAt, id }
}

/** Priority ascending (1 = most urgent), then newest first — matches the schema's [workspaceId, status, priority, createdAt] index. */
export async function listReviewItems(params: ListReviewItemsParams, workspaceId: string) {
  const { db } = await import("@life-os/db")
  const limit = Math.min(200, Math.max(1, Math.round(params.limit ?? 50)))

  const and: Record<string, unknown>[] = []
  and.push({ status: params.status ?? "pending" })
  if (params.source) and.push({ source: params.source })
  if (params.itemType) and.push({ itemType: params.itemType })
  if (params.riskTier) and.push({ riskTier: params.riskTier })

  if (params.cursor) {
    const { priority, createdAt, id } = decodeReviewCursor(params.cursor)
    and.push({
      OR: [
        { priority: { gt: priority } },
        { priority, createdAt: { lt: createdAt } },
        { priority, createdAt, id: { lt: id } },
      ],
    })
  }

  const where = { workspaceId, AND: and } as unknown as Prisma.ReviewItemWhereInput
  const rows = await db.reviewItem.findMany({
    where,
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page.at(-1)

  return {
    data: page.map(row => ({ ...row, proposedCommand: JSON.parse(row.proposedCommand) as { command: string; input: Record<string, unknown> } })),
    nextCursor: hasMore && last ? encodeReviewCursor(last.priority, last.createdAt, last.id) : null,
    hasMore,
    limit,
  }
}

function mergeEvidence(existing: string | null, patch: Record<string, unknown> | null): string | undefined {
  if (!patch) return undefined
  let base: Record<string, unknown> = {}
  if (existing) {
    try {
      base = JSON.parse(existing) as Record<string, unknown>
    } catch {
      base = {}
    }
  }
  return JSON.stringify({ ...base, ...patch })
}
