import { createId } from "@paralleldrive/cuid2"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"
import {
  fileIntelligenceFlags,
  getFileStorage,
  isExecutableMime,
  MAX_FILE_BYTES,
  safeFilename,
  sha256HexToBase64,
  supportedForExtraction,
  UPLOAD_URL_TTL_SECONDS,
} from "@life-os/files"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const access = await requireWorkspaceAccess()
    if (!fileIntelligenceFlags().ingestion) return NextResponse.json({ error: "File ingestion is disabled" }, { status: 503 })
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const filename = typeof body?.filename === "string" ? body.filename.trim() : ""
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType.toLowerCase().trim() : ""
    const sizeBytes = Number(body?.sizeBytes)
    const checksumHex = typeof body?.checksumSha256 === "string" ? body.checksumSha256.toLowerCase() : ""
    if (!filename || !mimeType || !Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Filename, MIME type, and a size from 1 byte to 100 MB are required" }, { status: 400 })
    }
    if (isExecutableMime(mimeType, filename)) return NextResponse.json({ error: "Executable files are not accepted" }, { status: 415 })
    let checksumSha256: string
    try { checksumSha256 = sha256HexToBase64(checksumHex) } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid checksum" }, { status: 400 })
    }

    const id = createId()
    const safe = safeFilename(filename)
    const key = `workspaces/${access.workspaceId}/files/${id}/${safe}`
    const storage = getFileStorage()
    const storeOnly = body?.storeOnly === true || !supportedForExtraction(mimeType, filename)
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000)
    await db.fileUploadIntent.create({ data: {
      id, workspaceId: access.workspaceId, expiresAt, filename, safeFilename: safe,
      mimeType, format: safe.split(".").pop()?.toLowerCase() ?? "unknown", sizeBytes,
      checksumSha256, storageProvider: storage.provider, storageKey: key, storeOnly,
    } })

    if (storage.provider === "local") {
      return NextResponse.json({
        intentId: id, expiresAt, storeOnly,
        upload: { url: `/api/files/upload-intents/${id}/content`, method: "PUT", headers: { "content-type": mimeType, "x-life-os-sha256": checksumHex } },
      }, { status: 201 })
    }
    const upload = await storage.createUpload(key, mimeType, checksumSha256)
    return NextResponse.json({ intentId: id, expiresAt, storeOnly, upload }, { status: 201 })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
