import { db } from "@life-os/db"
import { publishGraphEvent, type GraphEventActor } from "./events"
import { ensureStateDefinitionInTransaction } from "./states"

type SafeGraphAction =
  | { kind: "event"; name: string; eventType: string; occurredAt: string }
  | { kind: "state"; entityType: string; entityId: string; stateType: string; stateValue: string; severity?: number }

export async function promoteSafeFileClaim(claimId: string, workspaceId: string, action: SafeGraphAction, actor: GraphEventActor = { type: "system" }) {
  return db.$transaction(async tx => {
    const claim = await tx.evidenceClaim.findFirst({
      where: { id: claimId, workspaceId },
      include: { sourceFile: { include: { notes: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true } } } } },
    })
    if (!claim) throw new Error("Evidence claim not found")
    if (claim.graphResultId) return { resultType: claim.graphResultType!, resultId: claim.graphResultId, graphEventId: claim.graphEventId!, created: false }
    if (claim.classification !== "explicit" || claim.status !== "unreviewed") throw new Error("Only unreviewed explicit claims may be safely promoted")
    if (isSensitive(`${claim.claimType ?? ""} ${claim.assertion} ${JSON.stringify(action)}`)) throw new Error("Sensitive file evidence requires review")

    const sourceNoteId = claim.sourceFile.notes[0]?.id ?? null
    const provenance = { evidenceClaimId: claim.id, fileId: claim.sourceFileId, chunkId: claim.chunkId, sourceNoteId }
    const idempotencyKey = `file-claim-promote:${claim.id}`
    let resultType: "Event" | "State"
    let resultId: string

    if (action.kind === "event") {
      const occurredAt = new Date(action.occurredAt)
      if (Number.isNaN(occurredAt.getTime()) || occurredAt >= new Date()) throw new Error("Safe Event promotion requires an unambiguous past date")
      resultType = "Event"
      resultId = `file_event_${claim.id}`
      const duplicate = await tx.event.findFirst({ where: { workspaceId, name: action.name.trim(), type: action.eventType.trim(), start: occurredAt }, select: { id: true } })
      if (duplicate) throw new Error("Possible duplicate Event requires review")
      await tx.event.upsert({
        where: { id: resultId },
        update: {},
        create: {
          id: resultId, workspaceId, name: action.name.trim(), type: action.eventType.trim(), start: occurredAt,
          timestamp: occurredAt, sourceNoteId, metadata: JSON.stringify({ source: "file_evidence", ...provenance }),
        },
      })
    } else {
      const entityExists = action.entityType === "Person"
        ? await tx.person.count({ where: { id: action.entityId, workspaceId } })
        : action.entityType === "Place"
          ? await tx.place.count({ where: { id: action.entityId, workspaceId } })
          : action.entityType === "Item"
            ? await tx.item.count({ where: { id: action.entityId, workspaceId } })
            : action.entityType === "Group"
              ? await tx.group.count({ where: { id: action.entityId, workspaceId } })
              : 0
      if (!entityExists) throw new Error("Safe State promotion requires an existing resolved entity")
      const definition = await ensureStateDefinitionInTransaction(tx, {
        entityType: action.entityType, type: action.stateType, value: action.stateValue,
        description: `Recorded from cited file evidence claim ${claim.id}`,
      }, workspaceId)
      resultType = "State"
      resultId = `file_state_${claim.id}`
      const recordedAt = claim.occurredAt ?? claim.createdAt
      const duplicate = await tx.state.findFirst({ where: { workspaceId, entityType: action.entityType, entityId: action.entityId, definitionId: definition.id, recordedAt }, select: { id: true } })
      if (duplicate) throw new Error("Possible duplicate State requires review")
      await tx.state.upsert({
        where: { id: resultId },
        update: {},
        create: {
          id: resultId, workspaceId, entityType: action.entityType, entityId: action.entityId,
          definitionId: definition.id, severity: action.severity ?? null, source: "file_evidence",
          sourceNoteId, recordedAt,
        },
      })
    }

    const graphEvent = await publishGraphEvent(tx, {
      workspaceId, subjectType: resultType, subjectId: resultId,
      eventType: resultType === "Event" ? "event.create" : "state.record",
      actor, sourceConnector: "file_intelligence", idempotencyKey,
      payload: { evidenceClaimId: claim.id, safeAuto: true }, provenance,
    })
    await tx.evidenceClaim.update({ where: { id: claim.id }, data: { graphResultType: resultType, graphResultId: resultId, graphEventId: graphEvent.id } })
    return { resultType, resultId, graphEventId: graphEvent.id, created: true }
  })
}

function isSensitive(value: string) {
  return /health|medical|mental|financial|legal|employment|identity|emotion|relationship/i.test(value)
}

export async function undoSafeFileClaimPromotion(claimId: string, workspaceId: string, actor: GraphEventActor = { type: "user" }) {
  return db.$transaction(async tx => {
    const claim = await tx.evidenceClaim.findFirst({ where: { id: claimId, workspaceId } })
    if (!claim?.graphResultId || !claim.graphResultType) throw new Error("This claim has no safe-auto graph result to undo")
    const provenance = { evidenceClaimId: claim.id, fileId: claim.sourceFileId, chunkId: claim.chunkId, compensatesGraphEventId: claim.graphEventId }
    if (claim.graphResultType === "Event") await tx.event.deleteMany({ where: { id: claim.graphResultId, workspaceId } })
    else if (claim.graphResultType === "State") await tx.state.deleteMany({ where: { id: claim.graphResultId, workspaceId } })
    else throw new Error("Unsupported graph result type")
    const graphEvent = await publishGraphEvent(tx, {
      workspaceId, subjectType: claim.graphResultType, subjectId: claim.graphResultId,
      eventType: `${claim.graphResultType.toLowerCase()}.file_evidence_undo`, actor,
      sourceConnector: "file_intelligence", correlationId: claim.graphEventId,
      idempotencyKey: `file-claim-undo:${claim.id}`,
      payload: { evidenceClaimId: claim.id }, provenance,
    })
    await tx.evidenceClaim.update({ where: { id: claim.id }, data: { status: "reversed", reviewedAt: new Date(), reviewedBy: actor.id ?? null, graphEventId: graphEvent.id } })
    return { resultType: claim.graphResultType, resultId: claim.graphResultId, graphEventId: graphEvent.id }
  })
}
