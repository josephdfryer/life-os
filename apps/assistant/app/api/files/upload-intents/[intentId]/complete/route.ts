import { NextResponse } from "next/server"
import { start } from "workflow/api"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"
import { FILE_PROCESSOR_VERSION, getFileStorage, verifyFileSignature } from "@life-os/files"
import { processImportedFileWorkflow } from "@/workflows/process-file"

export async function POST(_request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const access = await requireWorkspaceAccess()
    const { intentId } = await context.params
    const intent = await db.fileUploadIntent.findFirst({ where: { id: intentId, workspaceId: access.workspaceId } })
    if (!intent) return NextResponse.json({ error: "Upload intent not found" }, { status: 404 })
    if (intent.status === "completed") {
      const existing = await db.importedFile.findUnique({ where: { uploadIntentId: intent.id }, include: { processingRuns: { orderBy: { createdAt: "desc" }, take: 1 } } })
      return NextResponse.json({ file: existing, idempotent: true })
    }
    if (intent.status !== "pending" || intent.expiresAt <= new Date()) return NextResponse.json({ error: "Upload intent is expired or unavailable" }, { status: 409 })

    const storage = getFileStorage()
    const [head, prefix] = await Promise.all([storage.head(intent.storageKey), storage.readPrefix(intent.storageKey)])
    if (head.sizeBytes !== intent.sizeBytes) return rejectIntent(intent.id, "Object size does not match upload intent")
    if (head.mimeType && head.mimeType !== intent.mimeType) return rejectIntent(intent.id, "Object MIME type does not match upload intent")
    if (head.checksumSha256 !== intent.checksumSha256) return rejectIntent(intent.id, "Object checksum does not match upload intent")
    if (!verifyFileSignature(prefix, intent.mimeType, intent.filename)) return rejectIntent(intent.id, "File signature does not match its declared format")

    const created = await db.$transaction(async tx => {
      const consumed = await tx.fileUploadIntent.updateMany({ where: { id: intent.id, status: "pending" }, data: { status: "completed", completedAt: new Date() } })
      if (consumed.count !== 1) throw new Error("Upload intent was already consumed")
      const file = await tx.importedFile.create({ data: {
        workspaceId: intent.workspaceId,
        filename: intent.filename,
        format: intent.format,
        filePath: intent.storageKey,
        sizeBytes: intent.sizeBytes,
        storageProvider: intent.storageProvider,
        storageKey: intent.storageKey,
        mimeType: intent.mimeType,
        checksum: intent.checksumSha256,
        uploadIntentId: intent.id,
        processingState: intent.storeOnly ? "store_only" : "queued",
      } })
      const run = await tx.fileProcessingRun.create({ data: {
        workspaceId: intent.workspaceId,
        sourceFileId: file.id,
        processorVersion: FILE_PROCESSOR_VERSION,
        runKey: `${file.id}:${FILE_PROCESSOR_VERSION}:1`,
      } })
      return { file, run }
    })

    const workflow = await start(processImportedFileWorkflow, [created.run.id])
    await db.fileProcessingRun.update({ where: { id: created.run.id }, data: { workflowRunId: workflow.runId } })
    return NextResponse.json({ file: created.file, processingRunId: created.run.id, workflowRunId: workflow.runId }, { status: 201 })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

async function rejectIntent(id: string, message: string) {
  await db.fileUploadIntent.update({ where: { id }, data: { status: "rejected" } })
  return NextResponse.json({ error: message }, { status: 422 })
}
