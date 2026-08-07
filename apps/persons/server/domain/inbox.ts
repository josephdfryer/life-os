import { db } from "@/lib/db"
import { badRequest, notFound, optionalString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import { applyRuleRunSuggestions, runRulesForTarget } from "./rules"
import { acceptStagedInteraction, AcceptStagedInteractionError } from "@life-os/domain"

// packages/domain's acceptStagedInteraction throws a generic, structured error
// (it cannot know about Persons' AppError/HTTP status shape — that would be an
// app-internal import from a shared package, which the dependency boundary
// rule forbids). This is the one place that translates it back into the HTTP
// error apps/persons/server/api/respond.ts already knows how to render.
function translateAcceptError(error: unknown): unknown {
  if (!(error instanceof AcceptStagedInteractionError)) return error
  if (error.code === "not_found") return notFound(error.message)
  return badRequest(error.message)
}

type InboxAction = "accept" | "dismiss" | "update"

export type StageRecordInput = {
  source: string
  sourceId: string
  itemType?: string
  type?: string
  timestamp: Date | string
  summary?: string | null
  body?: string | null
  direction?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  candidatePersonId?: string | null
  confidence?: number | null
  matchReason?: string | null
  metadata?: Record<string, unknown> | null
  trigger?: string
}

export async function stageRecord(input: StageRecordInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const timestamp = input.timestamp instanceof Date ? input.timestamp : new Date(input.timestamp)
  if (Number.isNaN(timestamp.getTime())) throw badRequest("timestamp is invalid", { field: "timestamp" })

  const itemType = input.itemType ?? "interaction"
  const metadataStr = input.metadata ? JSON.stringify(input.metadata) : null

  const staged = await db.stagedInteraction.upsert({
    where: { workspaceId_source_sourceId: { workspaceId, source: input.source, sourceId: input.sourceId } },
    update: {
      itemType,
      workspaceId,
      contactName: input.contactName ?? undefined,
      contactEmail: input.contactEmail ?? undefined,
      contactPhone: input.contactPhone ?? undefined,
      candidatePersonId: input.candidatePersonId ?? undefined,
      confidence: input.confidence ?? undefined,
      matchReason: input.matchReason ?? undefined,
      timestamp,
      summary: input.summary ?? undefined,
      body: input.body ?? undefined,
      direction: input.direction ?? undefined,
      metadata: metadataStr ?? undefined,
    },
    create: {
      source: input.source,
      workspaceId,
      sourceId: input.sourceId,
      itemType,
      status: "pending",
      type: input.type ?? "message",
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      candidatePersonId: input.candidatePersonId ?? null,
      confidence: input.confidence ?? null,
      matchReason: input.matchReason ?? null,
      timestamp,
      summary: input.summary ?? null,
      body: input.body ?? null,
      direction: input.direction ?? null,
      metadata: metadataStr,
    },
    select: { id: true, status: true, createdAt: true, updatedAt: true },
  })

  await auditAction({
    actor,
    action: "inbox.stage",
    targetType: "stagedInteraction",
    targetId: staged.id,
    metadata: { source: input.source, sourceId: input.sourceId, itemType },
  })

  // Enrich before rules fire so confidence/priority are available for condition matching
  const enriched = staged.status === "pending"
    ? await (await import("./inbox-enrich")).enrichInboxItem(staged.id, input, workspaceId, actor)
    : null

  // Obvious ads/automated content already got dismissed inside enrichInboxItem
  // — don't let a matching rule (e.g. an auto-accept rule) revive it.
  if (enriched?.autoDismissed) {
    return { ...staged, status: "dismissed" }
  }

  const ruleResult = await runRulesForTarget({
    trigger: input.trigger ?? "inbox.stage",
    targetType: "stagedInteraction",
    targetId: staged.id,
    payload: {
      stagedInteractionId: staged.id,
      source: input.source,
      sourceId: input.sourceId,
      itemType,
      type: input.type ?? "message",
      timestamp: timestamp.toISOString(),
      summary: enriched?.summary ?? input.summary,
      body: input.body,
      direction: input.direction,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      candidatePersonId: enriched?.candidatePersonId ?? input.candidatePersonId,
      confidence: enriched?.confidence ?? input.confidence,
      matchReason: enriched?.matchReason ?? input.matchReason,
      priority: enriched?.priority ?? 3,
      metadata: input.metadata,
    },
    actor,
    apply: true,
  })

  // Complete the accept flow when a rule auto-approved the item
  const wasAutoAccepted = ruleResult.actionsApplied.some(
    a => a.field === "status" && a.value === "accepted",
  )
  if (wasAutoAccepted) {
    const personId = enriched?.candidatePersonId ?? input.candidatePersonId
    if (personId) {
      await completeAccept(staged.id, personId, actor)
    }
  }

  return staged
}

async function completeAccept(id: string, personId: string, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  try {
    await acceptStagedInteraction({ id, workspaceId, personId, actor })
  } catch (error) {
    // Matches the previous silent-no-op behaviour: this runs after a rule
    // already auto-approved the item, so a resolution failure here (item
    // gone, person gone, bad timestamp) shouldn't crash the ingest pipeline.
    if (error instanceof AcceptStagedInteractionError) return
    throw error
  }
}

export async function applyInboxSuggestions(id: string, ruleRunIds: string[], actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const item = await db.stagedInteraction.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!item) throw notFound("Inbox item not found", { id })

  const result = await applyRuleRunSuggestions(ruleRunIds, id, actor)
  if (result.updatedRunIds.length) {
    await auditAction({
      actor,
      action: "inbox.apply_suggestions",
      targetType: "stagedInteraction",
      targetId: id,
      metadata: { ruleRunIds: result.updatedRunIds, actionsApplied: result.applied.length },
    })
  }
  return result
}

export async function updateInboxItem(id: string, body: Record<string, unknown>, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const action = body.action as InboxAction
  const item = await db.stagedInteraction.findFirst({ where: { id, workspaceId } })
  if (!item) throw notFound("Inbox item not found", { id })

  if (action === "dismiss") {
    const updated = await db.stagedInteraction.update({
      where: { id },
      data: { status: "dismissed" },
    })
    await auditAction({ actor, action: "inbox.dismiss", targetType: "stagedInteraction", targetId: id })
    return updated
  }

  if (action === "update") {
    const updated = await db.stagedInteraction.update({
      where: { id },
      data: {
        candidatePersonId: optionalString(body.personId),
        summary: body.summary === undefined ? undefined : optionalString(body.summary),
        direction: body.direction === undefined ? undefined : optionalString(body.direction),
        status: body.status === "pending" ? "pending" : undefined,
      },
    })
    await auditAction({ actor, action: "inbox.update", targetType: "stagedInteraction", targetId: id })
    return updated
  }

  if (action !== "accept") throw badRequest("Unsupported inbox action", { action })
  return acceptInboxItem(item.id, body, actor)
}

export async function bulkUpdateInboxItems(action: "dismiss" | "accept", ids: string[], actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  if (!Array.isArray(ids) || ids.length === 0) throw badRequest("ids required", { field: "ids" })
  const unique = [...new Set(ids)].slice(0, 500)

  if (action === "dismiss") {
    const result = await db.stagedInteraction.updateMany({
      where: { id: { in: unique }, workspaceId, status: { in: ["pending", "blocked"] } },
      data: { status: "dismissed" },
    })
    await auditAction({
      actor,
      action: "inbox.dismiss",
      targetType: "stagedInteraction",
      metadata: { bulk: true, count: result.count },
    })
    return { action, processed: result.count, skipped: unique.length - result.count, errors: [] as string[] }
  }

  // Accept: each item needs its candidate person and an interaction write, so
  // this loops — only items that already have a candidate attached qualify.
  const items = await db.stagedInteraction.findMany({
    where: { id: { in: unique }, workspaceId, status: { in: ["pending", "blocked"] } },
    select: { id: true, candidatePersonId: true },
  })
  let processed = 0
  let skipped = unique.length - items.length
  const errors: string[] = []
  for (const item of items) {
    if (!item.candidatePersonId) {
      skipped += 1
      continue
    }
    try {
      await acceptInboxItem(item.id, {}, actor)
      processed += 1
    } catch (error) {
      errors.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { action, processed, skipped, errors }
}

async function acceptInboxItem(id: string, body: Record<string, unknown>, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const item = await db.stagedInteraction.findFirst({ where: { id, workspaceId } })
  if (!item) throw notFound("Inbox item not found", { id })

  const personId = optionalString(body.personId) ?? item.candidatePersonId
  const summary = body.summary === undefined ? undefined : optionalString(body.summary)
  const direction = body.direction === undefined ? undefined : optionalString(body.direction)
  const timestamp = body.timestamp !== undefined ? String(body.timestamp) : undefined

  let result
  try {
    result = await acceptStagedInteraction({ id, workspaceId, personId, summary, direction, timestamp, actor })
  } catch (error) {
    throw translateAcceptError(error)
  }

  // acceptStagedInteraction already wrote the "inbox.accept" audit entry —
  // only the rules trigger is left here, and only for this human-triggered
  // path (completeAccept, the auto-approval path, never fired it either).
  await runRulesForTarget({
    trigger: "inbox.accept",
    targetType: "stagedInteraction",
    targetId: id,
    payload: {
      stagedInteractionId: id,
      interactionId: result.interactionId,
      personId: personId ?? item.candidatePersonId,
      source: item.source,
      sourceId: item.sourceId,
      itemType: item.itemType,
      type: item.type,
      timestamp: (timestamp ? new Date(timestamp) : item.timestamp).toISOString(),
      summary: summary || item.body || "(no text)",
      direction: direction ?? item.direction,
      contactName: item.contactName,
      contactEmail: item.contactEmail,
      contactPhone: item.contactPhone,
    },
    actor,
  })

  return db.stagedInteraction.findFirst({ where: { id } })
}
