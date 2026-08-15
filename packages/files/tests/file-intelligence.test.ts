import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url))
const migrationsDir = join(repoRoot, "packages/db/prisma/migrations")
const scratchDir = mkdtempSync(join(tmpdir(), "life-os-files-test-"))
const dbPath = join(scratchDir, "files.db")
process.env.DATABASE_URL = `file:${dbPath}`
process.env.TURSO_DATABASE_URL = ""
process.env.TURSO_AUTH_TOKEN = ""
process.env.FILE_INTELLIGENCE_REVIEW_PROPOSALS = "false"
process.env.FILE_INTELLIGENCE_SAFE_AUTO = "false"

const require = createRequire(import.meta.url)
const sqlite = new (require("better-sqlite3"))(dbPath)
sqlite.pragma("foreign_keys = OFF")
for (const dirname of readdirSync(migrationsDir).filter(name => name !== "migration_lock.toml").sort()) {
  sqlite.exec(readFileSync(join(migrationsDir, dirname, "migration.sql"), "utf8"))
}
sqlite.pragma("foreign_keys = ON")
sqlite.close()

test("file evidence remains cited, multi-subject, workspace-safe, relevance-aware, correctable, and undoable", async () => {
  const [{ db }, files, domain] = await Promise.all([import("@life-os/db"), import("../index"), import("@life-os/domain")])
  const workspaceId = "file-test-a"
  const otherWorkspaceId = "file-test-b"
  await db.workspace.createMany({ data: [
    { id: workspaceId, name: "File Test A", slug: workspaceId },
    { id: otherWorkspaceId, name: "File Test B", slug: otherWorkspaceId },
  ] })
  const [sarah, john, duplicateJohn, outsider] = await Promise.all([
    db.person.create({ data: { workspaceId, first: "Sarah", last: "Lee", emails: JSON.stringify(["sarah@example.com"]) } }),
    db.person.create({ data: { workspaceId, first: "John", last: "Smith", company: "Acme" } }),
    db.person.create({ data: { workspaceId, first: "John", last: "Smith", company: "Elsewhere" } }),
    db.person.create({ data: { workspaceId: otherWorkspaceId, first: "Sarah", last: "Lee", emails: JSON.stringify(["sarah@example.com"]) } }),
  ])
  await db.personExternalIdentifier.create({ data: { workspaceId, personId: john.id, externalId: "crm:john-42", provider: "crm" } })

  assert.equal((await files.resolvePersonMention({ chunkOrdinal: 0, entityType: "Person", sourceText: "Sarah Lee", role: "signer", exactQuote: "Sarah Lee", confidence: 1, email: "sarah@example.com" }, workspaceId)).personId, sarah.id)
  assert.equal((await files.resolvePersonMention({ chunkOrdinal: 0, entityType: "Person", sourceText: "John Smith", role: "signer", exactQuote: "John Smith", confidence: 1, externalId: "crm:john-42" }, workspaceId)).personId, john.id)
  assert.equal((await files.resolvePersonMention({ chunkOrdinal: 0, entityType: "Person", sourceText: "John Smith", role: "signer", exactQuote: "John Smith", confidence: 1 }, workspaceId)).status, "unresolved")
  assert.equal(files.relevanceWeight("explicit", "mentioned", "resolved"), 0)
  assert.equal(files.relevanceWeight("explicit", "participant", "resolved"), 0.5)
  assert.equal(files.relevanceWeight("inferred", "subject", "resolved"), 0.35)
  assert.equal(files.relevanceWeight("explicit", "subject", "unresolved"), 0)
  assert.equal(files.verifyFileSignature(new TextEncoder().encode("%PDF-1.7"), "application/pdf", "lease.pdf"), true)
  assert.equal(files.verifyFileSignature(new TextEncoder().encode("MZ executable"), "application/pdf", "lease.pdf"), false)
  // Was keyed off tool names, which meant any write tool added later was allowed
  // by default. Now keyed off declared capability, so the same intent holds for
  // tools that do not exist yet. Detailed cases live in write-guard.test.ts.
  assert.equal(files.fileEvidenceAllowsCapability("write", true), false)
  assert.equal(files.fileEvidenceAllowsCapability("destructive", true), false)
  assert.equal(files.fileEvidenceAllowsCapability("read", true), true)

  const citationResult = files.validateEvidenceCitations({
    summary: "Joint lease",
    mentions: [
      { chunkOrdinal: 0, entityType: "Person", sourceText: "Sarah Lee", role: "signer", exactQuote: "Sarah Lee", confidence: 1 },
      { chunkOrdinal: 0, entityType: "Person", sourceText: "John Smith", role: "signer", exactQuote: "John Smith", confidence: 1 },
      { chunkOrdinal: 0, entityType: "Person", sourceText: "Ghost", role: "mentioned", exactQuote: "not in source", confidence: 1 },
    ],
    claims: [
      { chunkOrdinal: 0, assertion: "Sarah and John signed together", classification: "explicit", exactQuote: "Sarah Lee and John Smith signed the lease", confidence: 1, subjectMentionIndexes: [0, 1], subjectRoles: ["signer", "signer"] },
      { chunkOrdinal: 0, assertion: "hallucinated", classification: "explicit", exactQuote: "not in source", confidence: 1, subjectMentionIndexes: [0], subjectRoles: ["subject"] },
    ],
  }, [{ ordinal: 0, content: "Sarah Lee and John Smith signed the lease", locatorType: "page", locator: { page: 1 } }])
  assert.equal(citationResult.mentions.length, 2)
  assert.equal(citationResult.claims.length, 1)
  assert.deepEqual(citationResult.claims[0].subjectMentionIndexes, [0, 1])

  const file = await db.importedFile.create({ data: { workspaceId, filename: "lease.pdf", format: "pdf", filePath: "s3://private/lease", sizeBytes: 42, storageProvider: "s3", storageKey: "workspaces/a/files/lease", processingState: "ready" } })
  const run = await db.fileProcessingRun.create({ data: { workspaceId, sourceFileId: file.id, processorVersion: "test", runKey: "test-run", status: "ready" } })
  const chunk = await db.fileChunk.create({ data: { workspaceId, sourceFileId: file.id, processingRunId: run.id, version: 1, ordinal: 0, content: "Sarah Lee and John Smith signed the lease", contentHash: "hash", locatorType: "page", locator: JSON.stringify({ page: 1 }) } })
  const [sarahMention, johnMention, incidentalMention] = await Promise.all([
    db.fileEntityMention.create({ data: { workspaceId, sourceFileId: file.id, processingRunId: run.id, chunkId: chunk.id, entityType: "Person", sourceText: "Sarah Lee", normalizedText: "sarah lee", role: "signer", exactQuote: "Sarah Lee", confidence: 1, resolutionStatus: "resolved", resolvedPersonId: sarah.id, resolvedEntityId: sarah.id, resolutionUpdatedAt: new Date() } }),
    db.fileEntityMention.create({ data: { workspaceId, sourceFileId: file.id, processingRunId: run.id, chunkId: chunk.id, entityType: "Person", sourceText: "John Smith", normalizedText: "john smith", role: "signer", exactQuote: "John Smith", confidence: 1, resolutionStatus: "resolved", resolvedPersonId: john.id, resolvedEntityId: john.id, resolutionUpdatedAt: new Date() } }),
    db.fileEntityMention.create({ data: { workspaceId, sourceFileId: file.id, processingRunId: run.id, chunkId: chunk.id, entityType: "Person", sourceText: "John Smith", normalizedText: "john smith", role: "mentioned", exactQuote: "John Smith", confidence: 0.5, resolutionStatus: "unresolved", resolutionUpdatedAt: new Date() } }),
  ])
  const claim = await db.evidenceClaim.create({ data: {
    workspaceId, sourceFileId: file.id, processingRunId: run.id, chunkId: chunk.id,
    assertion: "Sarah and John signed together", classification: "explicit", claimType: "milestone",
    exactQuote: chunk.content, confidence: 1, occurredAt: new Date("2020-01-01T00:00:00Z"),
    subjects: { create: [
      { mentionId: sarahMention.id, subjectRole: "signer", relevanceWeight: 0.75 },
      { mentionId: johnMention.id, subjectRole: "signer", relevanceWeight: 0.75 },
      { mentionId: incidentalMention.id, subjectRole: "mentioned", relevanceWeight: 0 },
    ] },
  }, include: { subjects: true } })
  assert.equal(claim.subjects.length, 3)
  assert.equal((await files.getPersonFileEvidence(sarah.id, workspaceId)).length, 1)
  assert.equal((await files.getPersonFileEvidence(outsider.id, otherWorkspaceId)).length, 0)

  const firstPromotion = await domain.promoteSafeFileClaim(claim.id, workspaceId, { kind: "event", name: "Household milestone", eventType: "milestone", occurredAt: "2020-01-01T00:00:00Z" }, { type: "rule", id: "test" })
  const retriedPromotion = await domain.promoteSafeFileClaim(claim.id, workspaceId, { kind: "event", name: "Household milestone", eventType: "milestone", occurredAt: "2020-01-01T00:00:00Z" }, { type: "rule", id: "test" })
  assert.equal(firstPromotion.resultId, retriedPromotion.resultId)
  assert.equal(await db.event.count({ where: { id: firstPromotion.resultId, workspaceId } }), 1)
  assert.equal(await db.graphEvent.count({ where: { workspaceId, idempotencyKey: `file-claim-promote:${claim.id}` } }), 1)
  await domain.undoSafeFileClaimPromotion(claim.id, workspaceId, { type: "user", id: "tester" })
  assert.equal(await db.event.count({ where: { id: firstPromotion.resultId } }), 0)
  assert.equal((await db.evidenceClaim.findUniqueOrThrow({ where: { id: claim.id } })).status, "reversed")

  const replacementClaim = await db.evidenceClaim.create({ data: {
    workspaceId, sourceFileId: file.id, processingRunId: run.id, chunkId: chunk.id,
    assertion: "Identity move test", classification: "explicit", exactQuote: "Sarah Lee", confidence: 1,
    subjects: { create: { mentionId: sarahMention.id, subjectRole: "subject", relevanceWeight: 0.75 } },
  } })
  assert.equal((await files.getTheoryEvidenceState(sarah.id, workspaceId)).stale, true)
  const beforeCorrection = new Date(Date.now() - 1_000)
  await db.theorySnapshot.createMany({ data: [
    { workspaceId, subjectPersonId: sarah.id, version: 1, title: "Sarah v1", summary: "", markdownBody: "", synthesizedAt: beforeCorrection },
    { workspaceId, subjectPersonId: duplicateJohn.id, version: 1, title: "John v1", summary: "", markdownBody: "", synthesizedAt: beforeCorrection },
  ] })
  await files.updateFileMention({ mentionId: sarahMention.id, workspaceId, action: "resolve", personId: duplicateJohn.id })
  assert.equal((await files.getPersonFileEvidence(sarah.id, workspaceId)).some(row => row.id === replacementClaim.id), false)
  assert.equal((await files.getPersonFileEvidence(duplicateJohn.id, workspaceId)).some(row => row.id === replacementClaim.id), true)
  assert.equal((await files.getTheoryEvidenceState(sarah.id, workspaceId)).stale, true)
  assert.equal((await files.getTheoryEvidenceState(duplicateJohn.id, workspaceId)).stale, true)

  const afterCorrection = new Date(Date.now() + 1_000)
  await db.theorySnapshot.updateMany({ where: { workspaceId, subjectPersonId: { in: [sarah.id, duplicateJohn.id] }, status: "current" }, data: { status: "archived" } })
  await db.theorySnapshot.create({ data: { workspaceId, subjectPersonId: duplicateJohn.id, version: 2, title: "John v2", summary: "", markdownBody: "", synthesizedAt: afterCorrection } })
  await db.importedFile.update({ where: { id: file.id }, data: { archivedAt: new Date(afterCorrection.getTime() + 1_000) } })
  assert.equal((await files.getPersonFileEvidence(duplicateJohn.id, workspaceId)).length, 0)
  assert.equal((await files.getTheoryEvidenceState(duplicateJohn.id, workspaceId)).stale, true)

  const pagedWorkspace = "file-test-paging"
  await db.workspace.create({ data: { id: pagedWorkspace, name: "Paging", slug: pagedWorkspace } })
  await db.person.createMany({ data: Array.from({ length: 105 }, (_, index) => ({ id: `page-person-${String(index).padStart(3, "0")}`, workspaceId: pagedWorkspace, first: "Page", last: String(index) })) })
  const pagingFile = await db.importedFile.create({ data: { workspaceId: pagedWorkspace, filename: "last.txt", format: "txt", filePath: "s3://private/last", sizeBytes: 1, processingState: "ready" } })
  const pagingRun = await db.fileProcessingRun.create({ data: { workspaceId: pagedWorkspace, sourceFileId: pagingFile.id, processorVersion: "test", runKey: "paging-run", status: "ready" } })
  const pagingChunk = await db.fileChunk.create({ data: { workspaceId: pagedWorkspace, sourceFileId: pagingFile.id, processingRunId: pagingRun.id, version: 1, ordinal: 0, content: "Page 104 arrived", contentHash: "paging", locatorType: "line", locator: "{}" } })
  const pagingMention = await db.fileEntityMention.create({ data: { workspaceId: pagedWorkspace, sourceFileId: pagingFile.id, processingRunId: pagingRun.id, chunkId: pagingChunk.id, entityType: "Person", sourceText: "Page 104", normalizedText: "page 104", role: "subject", exactQuote: "Page 104", confidence: 1, resolutionStatus: "resolved", resolvedPersonId: "page-person-104", resolvedEntityId: "page-person-104", resolutionUpdatedAt: new Date() } })
  await db.evidenceClaim.create({ data: { workspaceId: pagedWorkspace, sourceFileId: pagingFile.id, processingRunId: pagingRun.id, chunkId: pagingChunk.id, assertion: "Page 104 arrived", classification: "explicit", exactQuote: "Page 104 arrived", confidence: 1, subjects: { create: { mentionId: pagingMention.id, subjectRole: "subject", relevanceWeight: 0.75 } } } })
  const firstPage = await files.listStaleTheoryPeoplePage(pagedWorkspace, null, 100)
  assert.equal(firstPage.personIds.length, 0)
  assert.ok(firstPage.nextCursor)
  const secondPage = await files.listStaleTheoryPeoplePage(pagedWorkspace, firstPage.nextCursor, 100)
  assert.deepEqual(secondPage.personIds, ["page-person-104"])
  assert.equal(secondPage.nextCursor, null)
  assert.equal(files.theoryBudgetAllowsAttempt(0, 2), true)
  assert.equal(files.theoryBudgetAllowsAttempt(1, 2), true)
  assert.equal(files.theoryBudgetAllowsAttempt(2, 2), false)
  assert.equal((await files.getTheoryEvidenceState("page-person-104", pagedWorkspace)).stale, true)
  await db.$disconnect()
})
