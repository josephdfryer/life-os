import { db } from "@life-os/db"

export async function getDatabaseFileContent(id: string, workspaceId: string) {
  const file = await db.importedFile.findFirst({
    where: { id, workspaceId },
    select: { id: true, filename: true, format: true, mimeType: true, content: true },
  })
  if (!file || file.content === null) return null
  return {
    filename: safeFilename(file.filename),
    format: file.format,
    mimeType: file.mimeType || "text/plain; charset=utf-8",
    content: file.content,
  }
}

function safeFilename(filename: string) {
  const sanitized = filename.replace(/[\r\n"\\/]/g, "_").trim()
  return sanitized || "download.txt"
}
