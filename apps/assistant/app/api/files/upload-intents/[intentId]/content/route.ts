import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"
import { getFileStorage } from "@life-os/files"

export async function PUT(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const access = await requireWorkspaceAccess()
    const { intentId } = await context.params
    const storage = getFileStorage()
    if (!storage.writeForTesting) return NextResponse.json({ error: "Direct content upload is available only for local storage" }, { status: 405 })
    const intent = await db.fileUploadIntent.findFirst({ where: { id: intentId, workspaceId: access.workspaceId, status: "pending" } })
    if (!intent || intent.expiresAt <= new Date()) return NextResponse.json({ error: "Upload intent is missing or expired" }, { status: 404 })
    if (request.headers.get("content-type")?.split(";")[0] !== intent.mimeType) return NextResponse.json({ error: "MIME type does not match the signed intent" }, { status: 400 })
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (bytes.byteLength !== intent.sizeBytes) return NextResponse.json({ error: "Uploaded size does not match the intent" }, { status: 400 })
    const checksum = createHash("sha256").update(bytes).digest("base64")
    if (checksum !== intent.checksumSha256) return NextResponse.json({ error: "Uploaded checksum does not match the intent" }, { status: 400 })
    await storage.writeForTesting(intent.storageKey, bytes, intent.mimeType)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
