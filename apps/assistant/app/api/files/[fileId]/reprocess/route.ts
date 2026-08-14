import { NextResponse } from "next/server"
import { start } from "workflow/api"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"
import { FILE_PROCESSOR_VERSION } from "@life-os/files"
import { processImportedFileWorkflow } from "@/workflows/process-file"

export async function POST(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const access = await requireWorkspaceAccess()
    const { fileId } = await context.params
    const file = await db.importedFile.findFirst({ where: { id: fileId, workspaceId: access.workspaceId, archivedAt: null }, include: { _count: { select: { processingRuns: true } } } })
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })
    const run = await db.fileProcessingRun.create({ data: {
      workspaceId: access.workspaceId, sourceFileId: file.id, processorVersion: FILE_PROCESSOR_VERSION,
      runKey: `${file.id}:${FILE_PROCESSOR_VERSION}:${file._count.processingRuns + 1}`,
    } })
    const workflow = await start(processImportedFileWorkflow, [run.id])
    await db.fileProcessingRun.update({ where: { id: run.id }, data: { workflowRunId: workflow.runId } })
    await db.importedFile.update({ where: { id: file.id }, data: { processingState: "queued" } })
    return NextResponse.json({ processingRunId: run.id, workflowRunId: workflow.runId }, { status: 202 })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
