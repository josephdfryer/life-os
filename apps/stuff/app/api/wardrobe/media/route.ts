import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireStuffAccess } from "@/lib/access"
import { storeWardrobeImage } from "@/lib/media-storage"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const formData = await request.formData()
    const photo = formData.get("photo")
    if (!(photo instanceof File)) {
      return NextResponse.json({ error: "A photograph is required." }, { status: 400 })
    }

    const stored = await storeWardrobeImage(photo, access.workspaceId)
    const existing = await db.importedFile.findFirst({
      where: { workspaceId: access.workspaceId, checksum: stored.checksum },
    })
    if (existing) return NextResponse.json(fileResponse(existing))

    const importedFile = await db.importedFile.create({
      data: {
        workspaceId: access.workspaceId,
        filename: photo.name,
        format: photo.type.split("/")[1] ?? "image",
        filePath: stored.filePath,
        sizeBytes: stored.sizeBytes,
        storageProvider: "local",
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        checksum: stored.checksum,
        capturedAt: new Date(),
      },
    })

    return NextResponse.json(fileResponse(importedFile), { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not archive photograph."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

function fileResponse(file: { id: string; filename: string; mimeType: string | null; sizeBytes: number }) {
  return {
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    url: `/api/wardrobe/media/${file.id}`,
  }
}
