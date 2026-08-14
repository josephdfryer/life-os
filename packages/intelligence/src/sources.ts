import { db } from "@life-os/db"
import type { TheorySource, TheorySourceBundle } from "./types"

const DEFAULT_WORKSPACE = process.env.THEORY_WORKSPACE_ID ?? "default-workspace"

// Collect everything the stored graph currently knows about a person. This is
// read-only and makes no interpretation — it is the evidence base synthesis
// reasons over, and the provenance trail every snapshot points back to.
export async function getTheorySourcesForPerson(
  personId: string,
  workspaceId: string = DEFAULT_WORKSPACE
): Promise<TheorySourceBundle> {
  const person = await db.person.findFirst({
    where: { id: personId, workspaceId },
    select: { id: true, first: true, last: true, nickname: true, headline: true },
  })

  // Bounded, newest-first: synthesis reasons over the person's recent history,
  // not their entire lifetime — an unbounded read here scales with total
  // interactions ever recorded, not with anything synthesis actually needs,
  // and was already flagged as not surviving current production volume
  // (7,356+ interactions) before this cap existed.
  const interactions = await db.interaction.findMany({
    where: { workspaceId, personId },
    select: { id: true, eventId: true, sourceNoteId: true },
    orderBy: { timestamp: "desc" },
    take: 500,
  })

  const plans = await db.plan.findMany({
    where: {
      workspaceId,
      OR: [{ personId }, { expectedPeople: { some: { personId } } }],
    },
    select: { id: true, sourceNoteId: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  const states = await db.state.findMany({
    where: { workspaceId, entityType: "person", entityId: personId },
    select: { id: true, sourceNoteId: true },
    orderBy: { recordedAt: "desc" },
    take: 200,
  })

  // Notes about this person: theory observations (and any note) whose metadata
  // references the person, plus the source Notes behind their derived records.
  const taggedNotes = await db.note.findMany({
    where: { workspaceId, metadata: { contains: personId } },
    select: { id: true },
    orderBy: { timestamp: "desc" },
    take: 500,
  })

  const evidenceClaims = await db.evidenceClaim.findMany({
    where: {
      workspaceId,
      status: { notIn: ["dismissed", "superseded", "reversed"] },
      sourceFile: { archivedAt: null },
      subjects: { some: { relevanceWeight: { gt: 0 }, mention: { resolvedPersonId: personId, resolutionStatus: { in: ["resolved", "corrected"] } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
    include: {
      sourceFile: { select: { id: true, filename: true } },
      chunk: { select: { id: true, locator: true } },
      subjects: { include: { mention: { select: { resolvedPersonId: true, sourceText: true, role: true } } } },
    },
  })

  const eventIds = dedupe(interactions.map(i => i.eventId).filter(isString))
  const interactionIds = interactions.map(i => i.id)
  const planIds = plans.map(p => p.id)
  const stateIds = states.map(s => s.id)

  const provenanceNoteIds = dedupe([
    ...interactions.map(i => i.sourceNoteId),
    ...plans.map(p => p.sourceNoteId),
    ...states.map(s => s.sourceNoteId),
  ].filter(isString))
  const noteIds = dedupe([...taggedNotes.map(n => n.id), ...provenanceNoteIds])

  const sources: TheorySource[] = [
    ...(person ? [{ sourceType: "person" as const, sourceId: person.id }] : []),
    ...noteIds.map(id => ({ sourceType: "note" as const, sourceId: id })),
    ...eventIds.map(id => ({ sourceType: "event" as const, sourceId: id })),
    ...interactionIds.map(id => ({ sourceType: "interaction" as const, sourceId: id })),
    ...stateIds.map(id => ({ sourceType: "state" as const, sourceId: id })),
    ...planIds.map(id => ({ sourceType: "plan" as const, sourceId: id })),
    ...evidenceClaims.map(claim => {
      const direct = claim.subjects.filter(subject => subject.mention.resolvedPersonId === personId)
      const participants = claim.subjects.map(subject => `${subject.mention.sourceText} (${subject.subjectRole})`).join(", ")
      return {
        sourceType: "evidence_claim" as const,
        sourceId: claim.id,
        evidenceClaimId: claim.id,
        contribution: `${claim.assertion}${participants ? ` Participants: ${participants}.` : ""}`,
        weight: Math.max(...direct.map(subject => subject.relevanceWeight), 0),
        evidenceClassification: claim.classification as "explicit" | "inferred",
        evidenceStatus: claim.status,
        citation: { fileId: claim.sourceFile.id, filename: claim.sourceFile.filename, chunkId: claim.chunk.id, locator: claim.chunk.locator, exactQuote: claim.exactQuote },
      }
    }),
  ]

  return {
    personId,
    workspaceId,
    person,
    noteIds,
    eventIds,
    interactionIds,
    stateIds,
    planIds,
    evidenceClaimIds: evidenceClaims.map(claim => claim.id),
    sources,
  }
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0
}
