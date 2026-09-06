import { createHash } from "node:crypto"
import type { DeviceIngestItemInput } from "@life-os/contracts"
import { db } from "@life-os/db"
import { createReviewItem, publishGraphEvent, matchContact, createPerson, updatePerson } from "@life-os/domain"
import { HEALTH_DAILY_TRANSACTION, ensureHealthMetricDefinitions, recordHealthDailyDigestInTransaction, fireHealthDailyRules } from "./health-daily"

export type DeviceIngestResult = {
  sourceId: string
  status: "accepted" | "duplicate" | "retryable" | "rejected"
  resultType: string | null
  resultId: string | null
  errorCode: string | null
}

export async function ingestDeviceItem(item: DeviceIngestItemInput, workspaceId: string): Promise<DeviceIngestResult> {
  if (item.deviceId.length === 0) return rejected(item.sourceId, "invalid_device")
  const payloadHash = hashPayload(item)
  const existing = await db.deviceIngestItem.findUnique({
    where: { workspaceId_source_sourceId: { workspaceId, source: item.source, sourceId: item.sourceId } },
  })
  if (existing) {
    if (existing.payloadHash !== payloadHash) return rejected(item.sourceId, "source_id_conflict")
    await repairReviewIndex(existing.id, existing.resultType, existing.resultId, item, workspaceId)
    return { sourceId: item.sourceId, status: "duplicate", resultType: existing.resultType, resultId: existing.resultId, errorCode: null }
  }

  try {
    switch (item.record.type) {
      case "health.daily": return await ingestHealthDaily(item as ItemFor<"health.daily">, workspaceId, payloadHash)
      case "health.workout": return await ingestWorkout(item as ItemFor<"health.workout">, workspaceId, payloadHash)
      case "location.visit": return await ingestVisit(item as ItemFor<"location.visit">, workspaceId, payloadHash)
      case "communication.message": return await ingestCommunication(item as ItemFor<"communication.message">, workspaceId, payloadHash)
      case "voice.transcript": return await ingestNote(item, workspaceId, payloadHash, "voice_transcript", item.record.transcript)
      case "document.metadata": return await ingestNote(item, workspaceId, payloadHash, "import", item.record.extractedText ?? `Document captured: ${item.record.filename}`)
      case "photo.metadata": return await ingestNote(item, workspaceId, payloadHash, "observation", item.record.caption ?? `Photo metadata captured at ${item.record.capturedAt}`)
      case "contact.person": return await ingestContact(item as ItemFor<"contact.person">, workspaceId, payloadHash)
    }
  } catch (error) {
    if (isUniqueConflict(error)) {
      const raced = await db.deviceIngestItem.findUnique({
        where: { workspaceId_source_sourceId: { workspaceId, source: item.source, sourceId: item.sourceId } },
      })
      if (raced?.payloadHash === payloadHash) return { sourceId: item.sourceId, status: "duplicate", resultType: raced.resultType, resultId: raced.resultId, errorCode: null }
    }
    if (isDeviceReceiptUniqueConflict(error)) {
      return { sourceId: item.sourceId, status: "duplicate", resultType: null, resultId: null, errorCode: null }
    }
    console.error("[device/ingest] retryable item failure", { source: item.source, recordType: item.record.type, error })
    return { sourceId: item.sourceId, status: "retryable", resultType: null, resultId: null, errorCode: "temporary_failure" }
  }
}

type RecordType = DeviceIngestItemInput["record"]["type"]
type ItemFor<T extends RecordType> = Omit<DeviceIngestItemInput, "record"> & { record: Extract<DeviceIngestItemInput["record"], { type: T }> }

async function ingestHealthDaily(item: ItemFor<"health.daily">, workspaceId: string, payloadHash: string): Promise<DeviceIngestResult> {
  const personId = await workspaceOwnerPersonId(workspaceId)
  if (!personId) return rejected(item.sourceId, "owner_person_missing")
  const marker = `healthkit:${item.deviceId}:day:${item.record.day}`
  const actor = { type: "system" as const, id: item.deviceId, label: "life-os-companion" }
  const definitions = await ensureHealthMetricDefinitions(workspaceId, item.record.metrics.map(metric => metric.key))
  const { noteId, states } = await db.$transaction(async tx => {
    const result = await recordHealthDailyDigestInTransaction(tx, definitions, {
      workspaceId, personId, day: item.record.day,
      samples: item.record.metrics.map(metric => ({ key: metric.key, value: metric.value })),
      source: "healthkit", marker, contentLabel: "HealthKit daily digest",
      metadataExtra: {
        source: "healthkit",
        deviceId: item.deviceId,
        units: Object.fromEntries(item.record.metrics.filter(metric => metric.unit).map(metric => [metric.key, metric.unit])),
      },
      actor,
    })
    await tx.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "State", result.noteId) })
    return result
  }, HEALTH_DAILY_TRANSACTION)
  await fireHealthDailyRules(states, actor).catch(error => console.warn("[device/ingest] state rule dispatch failed", { sourceId: item.sourceId, error }))
  return accepted(item.sourceId, "State", states[0]?.state.id ?? null)
}

async function ingestWorkout(item: ItemFor<"health.workout">, workspaceId: string, payloadHash: string): Promise<DeviceIngestResult> {
  const actor = { type: "system" as const, id: item.deviceId, label: "life-os-companion" }
  const event = await db.$transaction(async tx => {
    const created = await tx.event.create({ data: {
      workspaceId, name: item.record.workoutType, type: "workout", start: new Date(item.record.startedAt),
      end: item.record.endedAt ? new Date(item.record.endedAt) : null, timestamp: new Date(item.record.startedAt),
      metadata: JSON.stringify({ source: "healthkit", sourceId: item.sourceId, deviceId: item.deviceId, durationSeconds: item.record.durationSeconds, energyKcal: item.record.energyKcal, distanceMeters: item.record.distanceMeters }),
    } })
    await publishGraphEvent(tx, { workspaceId, subjectType: "Event", subjectId: created.id, eventType: "event.create", actor, sourceConnector: "healthkit", idempotencyKey: `device:${item.deviceId}:${item.source}:${item.sourceId}`, payload: { type: "workout" }, provenance: { deviceId: item.deviceId, sourceId: item.sourceId } })
    await tx.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "Event", created.id) })
    return created
  })
  return accepted(item.sourceId, "Event", event.id)
}

async function ingestVisit(item: ItemFor<"location.visit">, workspaceId: string, payloadHash: string): Promise<DeviceIngestResult> {
  const visit = await db.$transaction(async tx => {
    const job = await tx.importJob.create({ data: { workspaceId, status: "done", format: "life-os-companion-visit-v1", filename: `device:${item.deviceId}`, totalRows: 1, processedRows: 1, stagedRows: 1, startedAt: new Date(), finishedAt: new Date() } })
    const staged = await tx.importStagedVisit.create({ data: {
      importJobId: job.id, workspaceId, rawData: { source: "location", sourceId: item.sourceId, deviceId: item.deviceId, horizontalAccuracyMeters: item.record.horizontalAccuracyMeters },
      placeName: item.record.placeName, latitude: item.record.latitude, longitude: item.record.longitude,
      startedAt: new Date(item.record.startedAt), endedAt: item.record.endedAt ? new Date(item.record.endedAt) : null,
      confidence: accuracyConfidence(item.record.horizontalAccuracyMeters),
    } })
    const receipt = await tx.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "ImportStagedVisit", staged.id) })
    return { staged, receipt }
  })
  await repairReviewIndex(visit.receipt.id, "ImportStagedVisit", visit.staged.id, item, workspaceId)
  return accepted(item.sourceId, "ImportStagedVisit", visit.staged.id)
}

async function ingestCommunication(item: ItemFor<"communication.message">, workspaceId: string, payloadHash: string): Promise<DeviceIngestResult> {
  const staged = await db.$transaction(async tx => {
    const created = await tx.stagedInteraction.create({ data: {
      workspaceId, source: item.source, sourceId: item.sourceId, itemType: "interaction", status: "pending",
      contactName: item.record.contactName, contactPhone: item.record.contactHandle, type: item.record.channel === "call" ? "call" : "message",
      timestamp: new Date(item.observedAt), summary: item.record.text?.slice(0, 2_000) ?? `${item.record.direction} ${item.record.channel}`,
      body: item.record.text, direction: item.record.direction, metadata: JSON.stringify({ deviceId: item.deviceId, durationSeconds: item.record.durationSeconds }),
    } })
    const receipt = await tx.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "StagedInteraction", created.id) })
    return { created, receipt }
  })
  await repairReviewIndex(staged.receipt.id, "StagedInteraction", staged.created.id, item, workspaceId)
  return accepted(item.sourceId, "StagedInteraction", staged.created.id)
}

async function ingestNote(item: DeviceIngestItemInput, workspaceId: string, payloadHash: string, type: string, content: string): Promise<DeviceIngestResult> {
  const note = await db.$transaction(async tx => {
    const created = await tx.note.create({ data: { workspaceId, type, timestamp: new Date(item.observedAt), content, metadata: JSON.stringify({ source: item.source, sourceId: item.sourceId, deviceId: item.deviceId, record: item.record }) } })
    await publishGraphEvent(tx, { workspaceId, subjectType: "Note", subjectId: created.id, eventType: "note.create", actor: { type: "system", id: item.deviceId, label: "life-os-companion" }, sourceConnector: item.source, idempotencyKey: `device:${item.deviceId}:${item.source}:${item.sourceId}`, payload: { type }, provenance: { deviceId: item.deviceId, sourceId: item.sourceId } })
    await tx.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "Note", created.id) })
    return created
  })
  return accepted(item.sourceId, "Note", note.id)
}

// The CSV/vCard import UI's DUPLICATE_THRESHOLD (0.85) only ever decides a
// *label* there — a human reviews every row before anything is written,
// regardless of score. Here, crossing the threshold means an unattended
// write happens with nobody looking, which is a different risk class. The
// bar is set high enough that only exact-identifier matches qualify
// (findMatch scores an exact email 1.0, exact phone 0.97) — fuzzy name-only
// matches, even strong ones, always go to review instead.
const AUTO_APPLY_THRESHOLD = 0.95

// Sources whose records the person already curated by hand — their own
// address book, the Google contacts they saved, people they actually met in
// a calendar event. A brand-new record from one of these is low-touch and may
// be created without review. Anything else (a scraped Facebook friend list,
// later an Instagram following list) is a bulk list of people the user never
// chose to save, usually with no email or phone to match on, so an unmatched
// record must go to review — never straight to a Person. Before this gate a
// working Facebook scan would have auto-created one identifier-less Person
// per friend.
const CURATED_CONTACT_SOURCES: ReadonlySet<string> = new Set(["contacts", "google_contacts", "calendar"])

// Person.source provenance per device source. "ios_contacts" predates the
// other sources and is kept for compatibility with existing rows and filters.
const PERSON_SOURCE_BY_DEVICE_SOURCE: Record<string, string> = {
  contacts: "ios_contacts",
  google_contacts: "google_contacts",
  calendar: "calendar_attendees",
  facebook: "facebook",
}

async function ingestContact(item: ItemFor<"contact.person">, workspaceId: string, payloadHash: string): Promise<DeviceIngestResult> {
  const actor = { type: "system" as const, id: item.deviceId, label: "life-os-companion-persons" }
  const candidate = {
    first: item.record.givenName, last: item.record.familyName,
    company: item.record.organizationName, title: item.record.jobTitle,
    emails: item.record.emails, phones: item.record.phones,
    ...(item.record.birthday ? { birthday: item.record.birthday } : {}),
    ...(item.record.location ? { location: item.record.location } : {}),
    ...(item.record.profileUrl && item.source === "facebook" ? { facebook: item.record.profileUrl } : {}),
    ...(item.record.notes ? { notes: item.record.notes } : {}),
  }
  // Index-backed: exact keys via PersonContact plus fuzzy names via pg_trgm,
  // scored by the same matcher as before. See packages/domain/contact-lookup.ts.
  const match = await matchContact(candidate, workspaceId)

  // Confident identifier match: apply only the fields the matched Person is
  // currently missing (findMatch already computed this against the winning
  // candidate) — never overwrite a populated field. No human in the loop.
  if (match && match.score >= AUTO_APPLY_THRESHOLD) {
    if (Object.keys(match.fillableFields).length > 0) {
      await updatePerson(match.personId, match.fillableFields, workspaceId, actor)
    }
    await db.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "Person", match.personId) })
    return accepted(item.sourceId, "Person", match.personId)
  }

  // No match at all (not merely a weak one) from a curated source: the
  // device's address book is a list the person already curated by saving
  // these contacts on their own phone, not an arbitrary bulk file from an
  // unknown source — so a brand new contact is low-touch, create it
  // immediately rather than parking it in a review queue for something
  // nobody has to approve. An *ambiguous* match (some similarity but below
  // AUTO_APPLY_THRESHOLD) still goes to review below: guessing wrong there
  // means silently attaching this contact's data to the WRONG existing
  // person, a worse failure mode than a duplicate the merge tool can clean
  // up later. Non-curated sources (see CURATED_CONTACT_SOURCES) skip this
  // branch entirely and always land in review.
  const first = firstNameFor(item.record)
  if (!match && first && CURATED_CONTACT_SOURCES.has(item.source)) {
    const person = await createPerson({
      first, last: item.record.familyName, company: item.record.organizationName, title: item.record.jobTitle,
      emails: item.record.emails, phones: item.record.phones,
      source: PERSON_SOURCE_BY_DEVICE_SOURCE[item.source] ?? "ios_contacts",
      ...(item.record.birthday ? { birthday: item.record.birthday } : {}),
      ...(item.record.location ? { location: item.record.location } : {}),
      ...(item.record.profileUrl ? { facebook: item.source === "facebook" ? item.record.profileUrl : undefined, website: item.source !== "facebook" ? item.record.profileUrl : undefined } : {}),
      ...(item.record.notes ? { notes: item.record.notes } : {}),
    }, workspaceId, actor)
    await db.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "Person", person.id) })
    return accepted(item.sourceId, "Person", person.id)
  }

  // Ambiguous match, or no usable name at all (blank contact card): still
  // needs a human, via the contact.import command (packages/domain/contact-import.ts),
  // same as staged interactions/visits.
  const contactName = `${item.record.givenName ?? ""} ${item.record.familyName ?? ""}`.trim() || null
  const receipt = await db.deviceIngestItem.create({ data: receiptData(item, workspaceId, payloadHash, "ReviewItem", null) })
  await createReviewItem({
    workspaceId, source: "contact_import", sourceId: receipt.id, itemType: "person",
    command: "contact.import",
    commandInput: {
      contactName, first: item.record.givenName, last: item.record.familyName,
      company: item.record.organizationName, title: item.record.jobTitle,
      emails: item.record.emails, phones: item.record.phones,
      matchedPersonId: match?.personId ?? null,
    },
    targetType: match ? "Person" : null, targetId: match?.personId ?? null,
    confidence: match?.score ?? null,
    evidence: { deviceIngestItemId: receipt.id, source: item.source, sourceId: item.sourceId, matchReason: match?.reason ?? null },
    riskTier: "review", priority: 3,
  }).catch(error => console.warn("[device/ingest] contact review item creation failed", { sourceId: item.sourceId, error }))
  return accepted(item.sourceId, "ReviewItem", receipt.id)
}

// A device contact card is worth auto-creating as soon as it has anything
// name-shaped to show — givenName in the normal case, falling back to
// familyName or a company/org name (a card saved as just "Acme Plumbing" is
// still a real, useful entry). Nothing name-shaped at all (no name, no org —
// just a bare phone number, say) isn't worth a silent auto-create.
function firstNameFor(record: ItemFor<"contact.person">["record"]): string | null {
  return record.givenName?.trim() || record.familyName?.trim() || record.organizationName?.trim() || null
}

async function repairReviewIndex(receiptId: string, resultType: string | null, resultId: string | null, item: DeviceIngestItemInput, workspaceId: string) {
  if (!resultId || (resultType !== "StagedInteraction" && resultType !== "ImportStagedVisit")) return
  await createReviewItem({
    workspaceId, source: resultType === "StagedInteraction" ? "staged_interaction" : "import_staged_visit", sourceId: resultId,
    itemType: resultType === "StagedInteraction" ? "interaction" : "visit",
    command: resultType === "StagedInteraction" ? "staged_interaction.accept" : "import_staged_visit.review",
    commandInput: resultType === "StagedInteraction" ? { stagedInteractionId: resultId } : { stagedVisitId: resultId },
    evidence: { deviceIngestItemId: receiptId, source: item.source, sourceId: item.sourceId }, riskTier: "review", priority: 3,
  }).catch(error => console.warn("[device/ingest] review index repair failed", { resultType, error }))
}

function receiptData(item: DeviceIngestItemInput, workspaceId: string, payloadHash: string, resultType: string, resultId: string | null) {
  return { workspaceId, deviceId: item.deviceId, source: item.source, sourceId: item.sourceId, recordType: item.record.type, schemaVersion: item.schemaVersion, observedAt: new Date(item.observedAt), payloadHash, status: "accepted", resultType, resultId }
}

async function workspaceOwnerPersonId(workspaceId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { ownerUserId: true, members: { where: { status: "active" }, orderBy: { createdAt: "asc" }, take: 1, select: { userId: true } } } })
  const userId = workspace?.ownerUserId ?? workspace?.members[0]?.userId
  return userId ? (await db.user.findUnique({ where: { id: userId }, select: { personId: true } }))?.personId ?? null : null
}

function hashPayload(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex") }
// Out of 100, not out of 1: ImportStagedVisit.confidence is scored on the same
// scale as the Places importer, which gates on AUTO_CREATE_THRESHOLD 70 and
// STAGE_THRESHOLD 30. Returning a fraction here would have put every visit the
// phone reports below the threshold that decides whether a visit is worth
// staging at all. No rows had come through this path yet, so nothing to repair.
function accuracyConfidence(meters: number) { return Math.max(10, Math.min(100, 100 - meters / 10)) }
function accepted(sourceId: string, resultType: string, resultId: string | null): DeviceIngestResult { return { sourceId, status: "accepted", resultType, resultId, errorCode: null } }
function rejected(sourceId: string, errorCode: string): DeviceIngestResult { return { sourceId, status: "rejected", resultType: null, resultId: null, errorCode } }
function isUniqueConflict(error: unknown) { return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002") }
function isDeviceReceiptUniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("UNIQUE constraint failed: DeviceIngestItem.workspaceId, DeviceIngestItem.source, DeviceIngestItem.sourceId")
}
