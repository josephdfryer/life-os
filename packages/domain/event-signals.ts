import type { GraphEventActor } from "./events"
import type { AuditActor } from "./audit"
import { resolveReviewItem } from "./review"
import type { EventSignal } from "./event-signals-list"
import { listEventSignals } from "./event-signals-list"

export type { EventSignal } from "./event-signals-list"
export { listEventSignals }

const SIGNAL_SOURCES = new Set([
  "calendar_reconciliation",
  "note_suggestion",
  "communication_occurrence",
  "evidence_claim",
])

export type EventSignalAction = "not_event" | "went" | "didnt_go"

export class EventSignalError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation" | "unsupported") {
    super(message)
    this.name = "EventSignalError"
  }
}

// Register communication_occurrence review handlers for resolveEventSignal.
import "./communication-occurrence"

export async function resolveEventSignal(input: {
  workspaceId: string
  reviewItemId: string
  action: EventSignalAction
  actor?: GraphEventActor & AuditActor
}) {
  const { db } = await import("@life-os/db")
  const item = await db.reviewItem.findFirst({
    where: { id: input.reviewItemId, workspaceId: input.workspaceId, status: "pending" },
  })
  if (!item) throw new EventSignalError("Event signal not found", "not_found")
  if (!SIGNAL_SOURCES.has(item.source)) {
    throw new EventSignalError(`Unsupported signal source "${item.source}"`, "unsupported")
  }
  if (item.source === "evidence_claim" && !evidenceClaimsEvent(item.evidence)) {
    throw new EventSignalError("This file claim is not an event proposal", "unsupported")
  }

  const proposed = parseProposedCommand(item.proposedCommand)
  let resultType: string | null = null
  let resultId: string | null = null

  if (item.source === "calendar_reconciliation") {
    const planId = String(proposed.input.planId ?? item.sourceId)
    if (input.action === "went") {
      const resolved = await resolveReviewItem({
        id: item.id,
        workspaceId: input.workspaceId,
        action: "edit_and_accept",
        editedInput: { planId, action: "happened" },
        actor: input.actor,
      })
      resultType = resolved.resultType
      resultId = resolved.resultId
    } else if (input.action === "didnt_go") {
      const { recordOwnerAttendance } = await import("./calendar-schedule")
      await recordOwnerAttendance({ workspaceId: input.workspaceId, planId, action: "did_not_go" })
      await resolveReviewItem({
        id: item.id,
        workspaceId: input.workspaceId,
        action: "dismiss",
        reason: "didnt_go",
        actor: input.actor,
      })
      resultType = "Plan"
      resultId = planId
    } else {
      await resolveReviewItem({
        id: item.id,
        workspaceId: input.workspaceId,
        action: "edit_and_accept",
        editedInput: { planId, action: "cancelled" },
        actor: input.actor,
      })
    }
  } else if (item.source === "note_suggestion") {
    if (input.action === "went") {
      const resolved = await resolveReviewItem({
        id: item.id,
        workspaceId: input.workspaceId,
        action: "accept",
        actor: input.actor,
      })
      resultType = resolved.resultType
      resultId = resolved.resultId
    } else {
      await resolveReviewItem({
        id: item.id,
        workspaceId: input.workspaceId,
        action: "dismiss",
        reason: input.action,
        actor: input.actor,
      })
    }
  } else if (item.source === "communication_occurrence") {
    if (input.action === "went") {
      const resolved = await resolveReviewItem({
        id: item.id,
        workspaceId: input.workspaceId,
        action: "accept",
        actor: input.actor,
      })
      resultType = resolved.resultType
      resultId = resolved.resultId
    } else {
      await resolveReviewItem({
        id: item.id,
        workspaceId: input.workspaceId,
        action: "dismiss",
        reason: input.action,
        actor: input.actor,
      })
    }
  } else if (item.source === "evidence_claim") {
    const evidence = parseEvidence(item.evidence)
    const graphAction = parseEventGraphAction(evidence?.proposedGraphAction)
    if (input.action === "went" && graphAction) {
      const { promoteSafeFileClaim } = await import("./file-evidence")
      const promoted = await promoteSafeFileClaim(
        item.sourceId,
        input.workspaceId,
        {
          kind: "event",
          name: graphAction.name,
          eventType: graphAction.eventType,
          occurredAt: graphAction.occurredAt,
        },
        input.actor ?? { type: "user" },
      )
      await resolveReviewItem({
        id: item.id,
        workspaceId: input.workspaceId,
        action: "dismiss",
        reason: "promoted_as_event",
        actor: input.actor,
      })
      resultType = promoted.resultType
      resultId = promoted.resultId
    } else {
      await resolveReviewItem({
        id: item.id,
        workspaceId: input.workspaceId,
        action: "dismiss",
        reason: input.action,
        actor: input.actor,
      })
    }
  }

  await recordEventSignalFeedback({
    workspaceId: input.workspaceId,
    reviewItemId: item.id,
    source: item.source,
    sourceId: item.sourceId,
    action: input.action,
    title: toEventSignal(item, undefined).title,
    evidence: item.evidence,
    actor: input.actor,
  })

  return { action: input.action, resultType, resultId }
}

async function recordEventSignalFeedback(input: {
  workspaceId: string
  reviewItemId: string
  source: string
  sourceId: string
  action: EventSignalAction
  title: string
  evidence: string | null
  actor?: GraphEventActor & AuditActor
}) {
  const { db } = await import("@life-os/db")
  await db.note.create({
    data: {
      workspaceId: input.workspaceId,
      timestamp: new Date(),
      type: "event_signal_feedback",
      content: `${input.action}: ${input.title}`,
      metadata: JSON.stringify({
        reviewItemId: input.reviewItemId,
        source: input.source,
        sourceId: input.sourceId,
        action: input.action,
        title: input.title,
        evidence: input.evidence,
        actorType: input.actor?.type ?? "user",
        actorId: input.actor?.id ?? null,
      }),
    },
  })
}

function toEventSignal(row: {
  id: string
  source: string
  sourceId: string
  itemType: string
  proposedCommand: string
  evidence: string | null
  confidence: number | null
  priority: number
}, context?: {
  plan?: { id: string; text: string; scheduledStart: Date | null }
  suggestion?: { id: string; title: string; payload: string }
}): EventSignal {
  const proposed = parseProposedCommand(row.proposedCommand)
  const evidence = parseEvidence(row.evidence)
  const planId = row.source === "calendar_reconciliation"
    ? String(proposed.input.planId ?? row.sourceId)
    : null

  if (row.source === "communication_occurrence") {
    return {
      id: row.id,
      source: row.source,
      sourceId: row.sourceId,
      title: String(evidence?.title ?? proposed.input.title ?? "Message event"),
      detail: typeof evidence?.reason === "string" ? evidence.reason : null,
      when: typeof evidence?.occurredAt === "string" ? evidence.occurredAt : null,
      confidence: row.confidence,
      priority: row.priority,
      planId: null,
    }
  }

  if (row.source === "note_suggestion") {
    const payload = context?.suggestion?.payload ? parseEvidence(context.suggestion.payload) : null
    return {
      id: row.id,
      source: row.source,
      sourceId: row.sourceId,
      title: context?.suggestion?.title ?? "Suggested event",
      detail: typeof payload?.reason === "string" ? payload.reason : null,
      when: typeof payload?.timestamp === "string" ? payload.timestamp : null,
      confidence: row.confidence,
      priority: row.priority,
      planId: null,
    }
  }

  if (row.source === "evidence_claim") {
    const action = parseEventGraphAction(evidence?.proposedGraphAction)
    return {
      id: row.id,
      source: row.source,
      sourceId: row.sourceId,
      title: action?.name ?? String(evidence?.assertion ?? "File event"),
      detail: typeof evidence?.exactQuote === "string" ? evidence.exactQuote : null,
      when: action?.occurredAt ?? null,
      confidence: row.confidence,
      priority: row.priority,
      planId: null,
    }
  }

  return {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    title: context?.plan?.text ?? String(evidence?.title ?? "Calendar item"),
    detail: null,
    when: context?.plan?.scheduledStart?.toISOString()
      ?? (typeof evidence?.scheduledStart === "string" ? evidence.scheduledStart : null),
    confidence: row.confidence,
    priority: row.priority,
    planId,
  }
}

function parseProposedCommand(raw: string): { command: string; input: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(raw) as { command?: string; input?: Record<string, unknown> }
    return { command: parsed.command ?? "", input: parsed.input ?? {} }
  } catch {
    return { command: "", input: {} }
  }
}

function parseEvidence(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function evidenceClaimsEvent(raw: string | null): boolean {
  const evidence = parseEvidence(raw)
  return parseEventGraphAction(evidence?.proposedGraphAction) !== null
}

function parseEventGraphAction(value: unknown): {
  name: string
  eventType: string
  occurredAt: string
} | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (record.kind !== "event") return null
  const name = typeof record.name === "string" ? record.name.trim() : ""
  const eventType = typeof record.eventType === "string" ? record.eventType.trim() : ""
  const occurredAt = typeof record.occurredAt === "string" ? record.occurredAt : ""
  if (!name || !eventType || !occurredAt) return null
  return { name, eventType, occurredAt }
}

export function parseEventSignalAction(value: unknown): EventSignalAction | null {
  return value === "not_event" || value === "went" || value === "didnt_go" ? value : null
}
