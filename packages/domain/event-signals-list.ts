export type EventSignal = {
  id: string
  source: string
  sourceId: string
  title: string
  detail: string | null
  when: string | null
  confidence: number | null
  priority: number
  planId: string | null
}

const SIGNAL_SOURCES = new Set([
  "calendar_reconciliation",
  "note_suggestion",
  "communication_occurrence",
  "evidence_claim",
])

/** Read-only query for Home/Events widgets — kept free of resolve-side imports. */
export async function listEventSignals(input: {
  workspaceId: string
  limit?: number
}): Promise<EventSignal[]> {
  const { db } = await import("@life-os/db")
  const limit = input.limit ?? 12
  const rows = await db.reviewItem.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: "pending",
      OR: [
        { source: "calendar_reconciliation", itemType: "event" },
        { source: "note_suggestion", itemType: "event" },
        { source: "communication_occurrence", itemType: "event" },
        { source: "evidence_claim", itemType: "file_claim" },
      ],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    take: limit * 2,
  })

  const filtered = rows
    .filter(row => SIGNAL_SOURCES.has(row.source))
    .filter(row => row.source !== "evidence_claim" || evidenceClaimsEvent(row.evidence))
    .slice(0, limit)

  const planIds = filtered.filter(row => row.source === "calendar_reconciliation").map(row => row.sourceId)
  const suggestionIds = filtered.filter(row => row.source === "note_suggestion").map(row => row.sourceId)

  const [plans, suggestions] = await Promise.all([
    planIds.length
      ? db.plan.findMany({
          where: { workspaceId: input.workspaceId, id: { in: planIds } },
          select: { id: true, text: true, scheduledStart: true },
          take: limit,
        })
      : [],
    suggestionIds.length
      ? db.noteSuggestion.findMany({
          where: { workspaceId: input.workspaceId, id: { in: suggestionIds } },
          select: { id: true, title: true, payload: true },
          take: limit,
        })
      : [],
  ])

  const planById = new Map(plans.map(plan => [plan.id, plan]))
  const suggestionById = new Map(suggestions.map(suggestion => [suggestion.id, suggestion]))

  return filtered.map(row => toEventSignal(row, {
    plan: planById.get(row.sourceId),
    suggestion: suggestionById.get(row.sourceId),
  }))
}

function toEventSignal(row: {
  id: string
  source: string
  sourceId: string
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
