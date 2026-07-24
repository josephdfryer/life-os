import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { extname, join } from "node:path"

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])

export function mediaRoot() {
  return process.env.LIFE_OS_MEDIA_DIR
    ?? join(homedir(), "Library", "Application Support", "Life OS", "media")
}

export async function storeWardrobeImage(file: File, workspaceId: string) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error("Use a JPEG, PNG, WebP, HEIC, or HEIF image.")
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error("Image must be between 1 byte and 15 MB.")

  const bytes = Buffer.from(await file.arrayBuffer())
  const checksum = createHash("sha256").update(bytes).digest("hex")
  const extension = safeExtension(file.name, file.type)
  const storageKey = join("wardrobe", workspaceId, checksum.slice(0, 2), `${checksum}${extension}`)
  const filePath = join(mediaRoot(), storageKey)

  await mkdir(join(mediaRoot(), "wardrobe", workspaceId, checksum.slice(0, 2)), { recursive: true })
  await writeFile(filePath, bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error
  })

  return { checksum, storageKey, filePath, sizeBytes: bytes.byteLength, mimeType: file.type }
}

export async function readStoredFile(filePath: string) {
  return readFile(filePath)
}

function safeExtension(filename: string, mimeType: string) {
  const extension = extname(filename).toLowerCase()
  if (/^\.(jpe?g|png|webp|heic|heif)$/.test(extension)) return extension
  return mimeType === "image/png" ? ".png"
    : mimeType === "image/webp" ? ".webp"
      : mimeType === "image/heic" ? ".heic"
        : mimeType === "image/heif" ? ".heif"
          : ".jpg"
}
