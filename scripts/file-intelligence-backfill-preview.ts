import { db } from "@life-os/db"

const PAGE_SIZE = 200
let cursor: string | undefined
let total = 0
const byFormat = new Map<string, number>()
const byStorage = new Map<string, number>()

do {
  const page = await db.importedFile.findMany({
    where: { uploadIntentId: null, processingRuns: { none: {} } },
    orderBy: { id: "asc" }, take: PAGE_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, format: true, storageProvider: true },
  })
  for (const file of page) {
    total += 1
    byFormat.set(file.format, (byFormat.get(file.format) ?? 0) + 1)
    byStorage.set(file.storageProvider, (byStorage.get(file.storageProvider) ?? 0) + 1)
  }
  cursor = page.length === PAGE_SIZE ? page.at(-1)!.id : undefined
} while (cursor)

console.log(JSON.stringify({
  mode: "read_only_preview",
  candidates: total,
  byFormat: Object.fromEntries([...byFormat].sort()),
  byStorageProvider: Object.fromEntries([...byStorage].sort()),
  nextStep: "No files were changed. Existing files require a separate confirmed backfill run.",
}, null, 2))
await db.$disconnect()
