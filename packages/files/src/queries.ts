import { db } from "@life-os/db"

export async function indexFileChunks(input: { workspaceId: string; sourceFileId: string; filename: string; chunks: Array<{ id: string; content: string }> }) {
  for (const chunk of input.chunks) {
    await db.$executeRawUnsafe(
      `INSERT INTO FileChunkFts (chunkId, workspaceId, sourceFileId, filename, content) VALUES (?, ?, ?, ?, ?)`,
      chunk.id, input.workspaceId, input.sourceFileId, input.filename, chunk.content,
    )
  }
}

export async function searchFileChunks(input: { workspaceId: string; query: string; fileIds?: string[]; limit?: number }) {
  const limit = Math.min(50, Math.max(1, input.limit ?? 12))
  const fileIds = input.fileIds?.slice(0, 10) ?? []
  if (!input.query.trim()) return []
  const tokens = input.query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? []
  if (!tokens.length) return []
  const match = tokens.map(token => `"${token.replaceAll('"', '""')}"*`).join(" AND ")
  const fileClause = fileIds.length ? ` AND f.sourceFileId IN (${fileIds.map(() => "?").join(",")})` : ""
  return db.$queryRawUnsafe<Array<{ id: string; sourceFileId: string; filename: string; content: string; locator: string; rank: number }>>(
    `SELECT c.id, c.sourceFileId, i.filename, c.content, c.locator, bm25(FileChunkFts) AS rank
       FROM FileChunkFts f
       JOIN FileChunk c ON c.id = f.chunkId
       JOIN ImportedFile i ON i.id = c.sourceFileId
      WHERE FileChunkFts MATCH ? AND f.workspaceId = ? AND i.archivedAt IS NULL
        AND c.version = (SELECT MAX(latest.version) FROM FileChunk latest WHERE latest.sourceFileId = c.sourceFileId)${fileClause}
      ORDER BY rank LIMIT ?`,
    match, input.workspaceId, ...fileIds, limit,
  )
}

export async function getPersonFileEvidence(personId: string, workspaceId: string, since?: Date) {
  const person = await db.person.findFirst({ where: { id: personId, workspaceId }, select: { id: true } })
  if (!person) return []
  return db.evidenceClaim.findMany({
    where: {
      workspaceId,
      sourceFile: { archivedAt: null },
      status: { notIn: ["dismissed", "superseded", "reversed"] },
      ...(since ? { OR: [{ updatedAt: { gt: since } }, { subjects: { some: { mention: { resolutionUpdatedAt: { gt: since } } } } }] } : {}),
      subjects: { some: { relevanceWeight: { gt: 0 }, mention: { resolvedPersonId: personId, resolutionStatus: { in: ["resolved", "corrected"] } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      sourceFile: { select: { id: true, filename: true, archivedAt: true } },
      chunk: { select: { id: true, locator: true } },
      subjects: { include: { mention: { select: { id: true, sourceText: true, role: true, confidence: true, resolvedPersonId: true } } } },
      theorySnapshotSources: { where: { snapshot: { workspaceId, subjectPersonId: personId, status: "current" } }, select: { id: true } },
    },
  })
}

export async function getTheoryEvidenceState(personId: string, workspaceId: string) {
  const current = await db.theorySnapshot.findFirst({
    where: { workspaceId, subjectPersonId: personId, status: "current" },
    orderBy: { version: "desc" },
    select: { id: true, version: true, synthesizedAt: true },
  })
  const evidence = await getPersonFileEvidence(personId, workspaceId, current?.synthesizedAt)
  if (!current) return { current, stale: evidence.length > 0, newEvidenceCount: evidence.length, invalidationCount: 0, evidence }
  const connectedMention = {
    OR: [
      { resolvedPersonId: personId },
      { resolutionHistory: { some: { OR: [{ fromPersonId: personId }, { toPersonId: personId }] } } },
    ],
  }
  const invalidationCount = await db.evidenceClaim.count({ where: {
    workspaceId,
    OR: [
      { updatedAt: { gt: current.synthesizedAt }, status: { in: ["dismissed", "superseded", "reversed"] }, subjects: { some: { mention: connectedMention } } },
      { sourceFile: { archivedAt: { gt: current.synthesizedAt } }, subjects: { some: { mention: connectedMention } } },
      { subjects: { some: { mention: { resolutionHistory: { some: { createdAt: { gt: current.synthesizedAt }, OR: [{ fromPersonId: personId }, { toPersonId: personId }] } } } } } },
    ],
  } })
  return { current, stale: evidence.length > 0 || invalidationCount > 0, newEvidenceCount: evidence.length, invalidationCount, evidence }
}

export async function assertWorkspaceFiles(fileIds: string[], workspaceId: string) {
  const unique = [...new Set(fileIds)]
  if (unique.length > 10) throw new Error("At most ten files may be attached")
  const count = await db.importedFile.count({ where: { id: { in: unique }, workspaceId, archivedAt: null } })
  if (count !== unique.length) throw new Error("One or more attached files are unavailable")
  return unique
}
