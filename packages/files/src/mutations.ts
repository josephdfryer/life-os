import { db } from "@life-os/db"

export async function updateFileMention(input: { mentionId: string; workspaceId: string; action: "resolve" | "not_this_person"; personId?: string; actorId?: string | null }) {
  const mention = await db.fileEntityMention.findFirst({ where: { id: input.mentionId, workspaceId: input.workspaceId, entityType: "Person" } })
  if (!mention) throw new Error("Mention not found")
  if (input.action === "not_this_person") return db.$transaction(async tx => {
    const updated = await tx.fileEntityMention.update({ where: { id: mention.id }, data: {
      resolvedPersonId: null, resolvedEntityId: null, resolutionStatus: "dismissed",
      resolutionReason: "User marked identity incorrect", resolutionUpdatedAt: new Date(),
    } })
    await tx.fileEntityResolution.create({ data: { workspaceId: input.workspaceId, mentionId: mention.id, fromPersonId: mention.resolvedPersonId, action: "dismissed", actorId: input.actorId ?? null, reason: "User marked identity incorrect" } })
    return updated
  })
  if (!input.personId) throw new Error("A Person is required")
  const person = await db.person.findFirst({ where: { id: input.personId, workspaceId: input.workspaceId }, select: { id: true } })
  if (!person) throw new Error("Person not found")
  return db.$transaction(async tx => {
    const action = mention.resolvedPersonId && mention.resolvedPersonId !== person.id ? "corrected" : "resolved"
    const updated = await tx.fileEntityMention.update({ where: { id: mention.id }, data: {
      resolvedPersonId: person.id, resolvedEntityId: person.id, resolutionStatus: action,
      resolutionLevel: 0, resolutionReason: "User-confirmed identity", confidence: 1, resolutionUpdatedAt: new Date(),
    } })
    await tx.fileEntityResolution.create({ data: { workspaceId: input.workspaceId, mentionId: mention.id, fromPersonId: mention.resolvedPersonId, toPersonId: person.id, action, actorId: input.actorId ?? null, reason: "User-confirmed identity" } })
    return updated
  })
}

export async function reviewFileClaim(input: { claimId: string; workspaceId: string; actorId?: string | null; action: "accept" | "dismiss" | "correct"; assertion?: string; reason?: string }) {
  const claim = await db.evidenceClaim.findFirst({ where: { id: input.claimId, workspaceId: input.workspaceId }, include: { subjects: true } })
  if (!claim) throw new Error("Claim not found")
  if (input.action === "accept" || input.action === "dismiss") return db.evidenceClaim.update({ where: { id: claim.id }, data: {
    status: input.action === "accept" ? "accepted" : "dismissed", reviewedAt: new Date(), reviewedBy: input.actorId ?? null,
  } })
  const assertion = input.assertion?.trim()
  if (!assertion) throw new Error("Correction text is required")
  return db.$transaction(async tx => {
    const note = await tx.note.create({ data: {
      workspaceId: input.workspaceId, timestamp: new Date(), type: "observation", content: assertion,
      metadata: JSON.stringify({ source: "file_claim_correction", originalClaimId: claim.id, reason: input.reason ?? null }),
    } })
    const replacement = await tx.evidenceClaim.create({ data: {
      workspaceId: claim.workspaceId, sourceFileId: claim.sourceFileId, processingRunId: claim.processingRunId, chunkId: claim.chunkId,
      assertion, structuredValue: claim.structuredValue, classification: "explicit", claimType: claim.claimType,
      exactQuote: claim.exactQuote, startOffset: claim.startOffset, endOffset: claim.endOffset, occurredAt: claim.occurredAt,
      confidence: 1, status: "accepted", reviewedAt: new Date(), reviewedBy: input.actorId ?? null,
      supersedesClaimId: claim.id, correctionNoteId: note.id,
      subjects: { create: claim.subjects.map(subject => ({ mentionId: subject.mentionId, subjectRole: subject.subjectRole, relevanceWeight: 1 })) },
    } })
    await tx.evidenceClaim.update({ where: { id: claim.id }, data: { status: "superseded", reviewedAt: new Date(), reviewedBy: input.actorId ?? null } })
    return replacement
  })
}
