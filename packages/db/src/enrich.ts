// Attaching context to an Interaction, later.
//
// The point of finance-as-interactions (docs/FINANCE_INTERACTION_MODEL_PLAN.md)
// is that a transaction lands complete and queryable immediately, and the
// context — which Place, which Event, who benefited, which Plan — accrues
// afterwards, whenever the evidence shows up. That might be minutes later when
// a rule fires, or months later when a Google Timeline import finally covers
// the week in question.
//
// This module is the one supported way to attach that context. It exists so
// every source obeys the single rule that makes re-running enrichment safe:
//
//   Automation may only overwrite an edge whose band it wrote itself.
//   band === "manual" is immutable to automation, forever.
//
// Because of that rule, a reconciler can run nightly over the entire history
// without ever undoing a human correction.

import type { PrismaClient } from "../generated/prisma/client"

/** How much to trust an attached edge, strongest last. */
export type EnrichmentBand =
  | "suggested"    // a guess worth showing a human; not safe to aggregate on
  | "auto"         // confident automated match
  | "adjudicated"  // an expensive decision (e.g. LLM) worth not recomputing
  | "manual"       // a human said so — never overwritten by automation

/** Which primitive is being attached. */
export type EnrichmentEntityType = "Person" | "Place" | "Event" | "Group" | "Plan" | "State" | "Note" | "Item"

/**
 * Common roles. `location`/`occasion`/`beneficiary` are the finance workhorses;
 * the field is a free string so new roles don't need a migration.
 */
export type EnrichmentRole =
  | "payer" | "payee" | "merchant" | "location" | "occasion" | "beneficiary" | "household"
  | "subject" | "observer" | "mentioned" | "participant"
  | (string & {})

export type AttachContextInput = {
  interactionId: string
  workspaceId: string
  entityType: EnrichmentEntityType
  entityId: string
  /** Required. A null role would break the upsert key: SQLite treats NULLs as distinct. */
  role: EnrichmentRole
  band: EnrichmentBand
  /** Who decided this — "timeline-join", "merchant-map", "rule:groceries", "manual". */
  source: string
  /** 0–1. Omit only when the notion doesn't apply. */
  confidence?: number | null
  /** Anything that justifies the decision. Stored as JSON; this is the audit trail. */
  evidence?: unknown
}

export type AttachContextResult =
  | { status: "created"; id: string }
  | { status: "updated"; id: string }
  | { status: "unchanged"; id: string }
  | { status: "protected"; id: string } // a manual edge was left alone

/**
 * Attach (or refresh) one piece of context on an Interaction.
 *
 * Idempotent: calling it repeatedly with the same inputs is a no-op after the
 * first write, so reconcilers can be scheduled freely.
 *
 * ```ts
 * await attachContext(db, {
 *   interactionId, workspaceId,
 *   entityType: "Place", entityId: placeId, role: "location",
 *   band: "auto", source: "timeline-join", confidence: 0.92,
 *   evidence: { visitId, matchedName: "Sprouts Farmers Market" },
 * })
 * ```
 */
export async function attachContext(
  db: PrismaClient,
  input: AttachContextInput,
): Promise<AttachContextResult> {
  if (!input.role) throw new Error("attachContext: role is required (a null role breaks the upsert key)")

  const evidence = input.evidence === undefined ? null : JSON.stringify(input.evidence)
  const where = {
    interactionId_entityType_entityId_role: {
      interactionId: input.interactionId,
      entityType: input.entityType,
      entityId: input.entityId,
      role: input.role,
    },
  }

  const existing = await db.interactionParticipant.findUnique({
    where,
    select: { id: true, band: true, confidence: true, source: true, evidence: true },
  })

  // The whole safety story in one branch: a human already answered this.
  if (existing?.band === "manual" && input.band !== "manual") {
    return { status: "protected", id: existing.id }
  }

  if (!existing) {
    const created = await db.interactionParticipant.create({
      data: {
        interactionId: input.interactionId,
        workspaceId: input.workspaceId,
        entityType: input.entityType,
        entityId: input.entityId,
        role: input.role,
        band: input.band,
        source: input.source,
        confidence: input.confidence ?? null,
        evidence,
      },
      select: { id: true },
    })
    return { status: "created", id: created.id }
  }

  const unchanged =
    existing.band === input.band &&
    existing.source === input.source &&
    existing.confidence === (input.confidence ?? null) &&
    existing.evidence === evidence
  if (unchanged) return { status: "unchanged", id: existing.id }

  await db.interactionParticipant.update({
    where: { id: existing.id },
    data: {
      band: input.band,
      source: input.source,
      confidence: input.confidence ?? null,
      evidence,
    },
  })
  return { status: "updated", id: existing.id }
}

/**
 * Remove an attached edge. Refuses to remove a manual one unless `force` is set,
 * so a buggy reconciler cannot quietly erase a human decision.
 */
export async function detachContext(
  db: PrismaClient,
  input: Pick<AttachContextInput, "interactionId" | "entityType" | "entityId" | "role"> & { force?: boolean },
): Promise<"removed" | "protected" | "missing"> {
  const existing = await db.interactionParticipant.findUnique({
    where: {
      interactionId_entityType_entityId_role: {
        interactionId: input.interactionId,
        entityType: input.entityType,
        entityId: input.entityId,
        role: input.role,
      },
    },
    select: { id: true, band: true },
  })
  if (!existing) return "missing"
  if (existing.band === "manual" && !input.force) return "protected"
  await db.interactionParticipant.delete({ where: { id: existing.id } })
  return "removed"
}

/**
 * Mark an Interaction as reconciled at the current enrichment version. Rows
 * whose `enrichedAt` is null, or whose `enrichmentVersion` is below the current
 * one, are what a reconciler should pick up on its next pass.
 */
export async function markEnriched(db: PrismaClient, interactionId: string, version: number) {
  await db.interaction.update({
    where: { id: interactionId },
    data: { enrichedAt: new Date(), enrichmentVersion: version },
  })
}
