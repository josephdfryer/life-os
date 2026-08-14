import { db } from "@life-os/db"
import {
  chunkHash,
  extractEvidenceWithAi,
  extractFile,
  getFileStorage,
  indexFileChunks,
  persistFileEvidence,
  supportedForExtraction,
} from "@life-os/files"

export async function processImportedFileWorkflow(processingRunId: string) {
  "use workflow"
  console.log("[file-workflow] starting", processingRunId)
  try {
    const verified = await verifyAndLoad(processingRunId)
    if (verified.storeOnly) return await markStoreOnly(processingRunId)
    const extracted = await extractFaithfully(processingRunId, verified)
    const persisted = await persistChunksAndNote(processingRunId, extracted)
    const evidence = await extractAndPersistEvidence(processingRunId, persisted)
    return await completeRun(processingRunId, extracted.warning, evidence)
  } catch (error) {
    await failRun(processingRunId, error instanceof Error ? error.message : "Unknown processing error")
    throw error
  }
}

async function verifyAndLoad(processingRunId: string) {
  "use step"
  console.log("[file-workflow] verify", processingRunId)
  const run = await db.fileProcessingRun.findUnique({
    where: { id: processingRunId },
    include: { sourceFile: true },
  })
  if (!run) throw new Error("Processing run not found")
  if (run.sourceFile.archivedAt) throw new Error("Archived files cannot be processed")
  await db.fileProcessingRun.update({ where: { id: run.id }, data: { status: "processing", startedAt: run.startedAt ?? new Date() } })
  const bytes = await getFileStorage().read(run.sourceFile.storageKey ?? run.sourceFile.filePath)
  if (bytes.byteLength !== run.sourceFile.sizeBytes) throw new Error("Stored object size changed after upload verification")
  return {
    bytes,
    workspaceId: run.workspaceId,
    sourceFileId: run.sourceFileId,
    filename: run.sourceFile.filename,
    mimeType: run.sourceFile.mimeType ?? "application/octet-stream",
    storeOnly: run.sourceFile.processingState === "store_only" || !supportedForExtraction(run.sourceFile.mimeType ?? "", run.sourceFile.filename),
  }
}

async function extractFaithfully(processingRunId: string, input: Awaited<ReturnType<typeof verifyAndLoad>>) {
  "use step"
  console.log("[file-workflow] extract", processingRunId, input.filename)
  return extractFile(input.bytes, input.mimeType, input.filename)
}

async function persistChunksAndNote(processingRunId: string, extracted: Awaited<ReturnType<typeof extractFaithfully>>) {
  "use step"
  console.log("[file-workflow] persist chunks", processingRunId, extracted.chunks.length)
  const run = await db.fileProcessingRun.findUnique({ where: { id: processingRunId }, include: { sourceFile: true } })
  if (!run) throw new Error("Processing run not found")
  const existing = await db.fileChunk.findMany({ where: { processingRunId }, orderBy: { ordinal: "asc" } })
  if (existing.length) return { run, chunks: existing.map(asExtractedChunk), extractionMethod: extracted.extractionMethod }

  const priorVersion = await db.fileChunk.aggregate({ where: { sourceFileId: run.sourceFileId }, _max: { version: true } })
  const version = (priorVersion._max.version ?? 0) + 1
  const created = await db.$transaction(async tx => {
    await tx.note.upsert({
      where: { id: `file-note-${run.sourceFileId}` },
      update: {
        content: extracted.chunks.map(chunk => chunk.content).join("\n\n"),
        metadata: JSON.stringify({ extractionMethod: extracted.extractionMethod, processorVersion: run.processorVersion, chunkVersion: version }),
      },
      create: {
        id: `file-note-${run.sourceFileId}`,
        workspaceId: run.workspaceId,
        timestamp: run.sourceFile.capturedAt ?? run.sourceFile.createdAt,
        type: "import",
        content: extracted.chunks.map(chunk => chunk.content).join("\n\n"),
        metadata: JSON.stringify({ extractionMethod: extracted.extractionMethod, processorVersion: run.processorVersion, chunkVersion: version }),
        sourceFileId: run.sourceFileId,
      },
    })
    const rows = []
    for (const chunk of extracted.chunks) {
      rows.push(await tx.fileChunk.create({ data: {
        workspaceId: run.workspaceId,
        sourceFileId: run.sourceFileId,
        processingRunId,
        version,
        ordinal: chunk.ordinal,
        content: chunk.content,
        contentHash: chunkHash(chunk.content),
        locatorType: chunk.locatorType,
        locator: JSON.stringify(chunk.locator),
      } }))
    }
    return rows
  })
  await indexFileChunks({ workspaceId: run.workspaceId, sourceFileId: run.sourceFileId, filename: run.sourceFile.filename, chunks: created })
  return { run, chunks: created.map(asExtractedChunk), extractionMethod: extracted.extractionMethod }
}

function asExtractedChunk(row: Awaited<ReturnType<typeof db.fileChunk.findFirst>> & object) {
  const value = row as NonNullable<typeof row> & { locatorType: string; locator: string }
  return { ...value, locatorType: value.locatorType as "page" | "section" | "cell" | "image_region" | "audio_timestamp" | "line", locator: JSON.parse(value.locator) }
}

async function extractAndPersistEvidence(processingRunId: string, persisted: Awaited<ReturnType<typeof persistChunksAndNote>>) {
  "use step"
  console.log("[file-workflow] evidence", processingRunId)
  if (!persisted.chunks.length) return { mentionsCreated: 0, claimsCreated: 0, rejectedMentions: 0, rejectedClaims: 0 }
  if (await db.fileEntityMention.count({ where: { processingRunId } })) {
    return {
      mentionsCreated: await db.fileEntityMention.count({ where: { processingRunId } }),
      claimsCreated: await db.evidenceClaim.count({ where: { processingRunId } }),
      rejectedMentions: 0, rejectedClaims: 0,
    }
  }
  const analysis = await db.aiAnalysisRun.create({ data: {
    workspaceId: persisted.run.workspaceId,
    sourceFileId: persisted.run.sourceFileId,
    processingRunId,
    provider: "vercel-ai-gateway",
    modelId: "openai/gpt-5.4",
    status: "running",
    promptVersion: "file-evidence-v1",
    purpose: "file_evidence_extraction",
  } })
  try {
    const evidence = await extractEvidenceWithAi({ filename: persisted.run.sourceFile.filename, chunks: persisted.chunks })
    const result = await persistFileEvidence({
      workspaceId: persisted.run.workspaceId,
      sourceFileId: persisted.run.sourceFileId,
      processingRunId,
      chunks: persisted.chunks,
      evidence,
    })
    await db.aiAnalysisRun.update({ where: { id: analysis.id }, data: { status: "completed", completedAt: new Date(), output: JSON.stringify({ summary: evidence.summary, ...result }) } })
    return result
  } catch (error) {
    await db.aiAnalysisRun.update({ where: { id: analysis.id }, data: { status: "failed", completedAt: new Date(), error: error instanceof Error ? error.message : "Evidence extraction failed" } })
    throw error
  }
}

async function markStoreOnly(processingRunId: string) {
  "use step"
  console.log("[file-workflow] store only", processingRunId)
  const run = await db.fileProcessingRun.update({ where: { id: processingRunId }, data: { status: "store_only", completedAt: new Date(), summary: "Stored privately without extraction" } })
  await db.importedFile.update({ where: { id: run.sourceFileId }, data: { processingState: "store_only" } })
  return { status: "store_only" }
}

async function completeRun(processingRunId: string, warning: string | undefined, evidence: Awaited<ReturnType<typeof extractAndPersistEvidence>>) {
  "use step"
  console.log("[file-workflow] complete", processingRunId)
  const status = warning || evidence.rejectedClaims || evidence.rejectedMentions ? "partial" : "ready"
  const run = await db.fileProcessingRun.update({
    where: { id: processingRunId },
    data: { status, completedAt: new Date(), summary: JSON.stringify({ warning, ...evidence }) },
  })
  await db.evidenceClaim.updateMany({
    where: { sourceFileId: run.sourceFileId, processingRunId: { not: processingRunId }, status: { in: ["unreviewed", "accepted"] } },
    data: { status: "superseded" },
  })
  await db.importedFile.update({ where: { id: run.sourceFileId }, data: { processingState: status } })
  return { status, ...evidence }
}

async function failRun(processingRunId: string, message: string) {
  "use step"
  console.error("[file-workflow] failed", processingRunId, message)
  const run = await db.fileProcessingRun.update({ where: { id: processingRunId }, data: { status: "failed", completedAt: new Date(), error: message } })
  await db.importedFile.update({ where: { id: run.sourceFileId }, data: { processingState: "failed" } })
}
