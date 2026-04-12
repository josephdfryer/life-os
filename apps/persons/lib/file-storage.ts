import { db } from "@/lib/db"
import { createId } from "@paralleldrive/cuid2"

/**
 * Store a file. Content is saved directly to the DB so it's available
 * everywhere without external object storage.
 * filePath is kept for backward compatibility with older records.
 */
export async function storeFile(filename: string, format: string, content: string) {
  const fileId = createId()

  return db.importedFile.create({
    data: {
      id: fileId,
      filename,
      format,
      filePath: `db:${fileId}`,          // sentinel — content lives in DB
      sizeBytes: Buffer.byteLength(content, "utf8"),
      content,
    },
  })
}

/**
 * Retrieve raw file content.
 * Handles both new DB-stored files and legacy local-filesystem files.
 */
export async function getFileContent(id: string): Promise<{ filename: string; content: string; format: string } | null> {
  const file = await db.importedFile.findUnique({ where: { id } })
  if (!file) return null

  // New style: content stored in DB
  if (file.content) {
    return { filename: file.filename, content: file.content, format: file.format }
  }

  // Legacy: content on local filesystem
  if (file.filePath && !file.filePath.startsWith("db:")) {
    try {
      const fs = await import("fs")
      if (fs.existsSync(file.filePath)) {
        const content = fs.readFileSync(file.filePath, "utf8")
        return { filename: file.filename, content, format: file.format }
      }
    } catch {
      // File gone — fall through to null
    }
  }

  return null
}
