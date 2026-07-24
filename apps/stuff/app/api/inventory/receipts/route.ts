import { NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { storeProcurementDocument } from "@/lib/media-storage"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const formData = await request.formData()
    const receipt = formData.get("receipt")
    if (!(receipt instanceof File)) return NextResponse.json({ error: "A receipt file is required" }, { status: 400 })
    const stored = await storeProcurementDocument(receipt, access.workspaceId)
    const existing = await db.importedFile.findFirst({
      where: { workspaceId: access.workspaceId, checksum: stored.checksum },
    })
    if (existing) return NextResponse.json({ id: existing.id, filename: existing.filename })
    const imported = await db.importedFile.create({
      data: {
        workspaceId: access.workspaceId,
        filename: receipt.name,
        format: receipt.type === "application/pdf" ? "pdf" : receipt.type.split("/")[1] ?? "file",
        filePath: stored.filePath,
        sizeBytes: stored.sizeBytes,
        storageProvider: "local",
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        checksum: stored.checksum,
        capturedAt: new Date(),
      },
    })
    return NextResponse.json({ id: imported.id, filename: imported.filename }, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not archive receipt",
    }, { status: 400 })
  }
}
