import { db } from "@life-os/db"
import { THEORY_STATUS } from "./types"
import type { TheorySynthesis } from "./types"

const DEFAULT_WORKSPACE = process.env.THEORY_WORKSPACE_ID ?? "default-workspace"

// Persist a synthesis as a new append-only snapshot.
// Versioning rules: never overwrite. Find max version, create version + 1 as the
// new `current`, and archive the prior `current`. All in one transaction.
export async function createTheorySnapshot(
  personId: string,
  synthesis: TheorySynthesis,
  workspaceId: string = DEFAULT_WORKSPACE
): Promise<string> {
  return db.$transaction(async tx => {
    const latest = await tx.theorySnapshot.findFirst({
      where: { subjectPersonId: personId },
      orderBy: { version: "desc" },
      select: { version: true },
    })
    const nextVersion = (latest?.version ?? 0) + 1

    // Demote any existing current snapshot for this person.
    await tx.theorySnapshot.updateMany({
      where: { subjectPersonId: personId, status: THEORY_STATUS.current },
      data: { status: THEORY_STATUS.archived },
    })

    const snapshot = await tx.theorySnapshot.create({
      data: {
        workspaceId,
        subjectPersonId: personId,
        version: nextVersion,
        title: synthesis.title,
        summary: synthesis.summary,
        markdownBody: synthesis.markdownBody,
        status: THEORY_STATUS.current,
        confidence: synthesis.confidence ?? null,
        sources: {
          create: synthesis.sources.map(s => ({
            sourceType: s.sourceType,
            sourceId: s.sourceId,
            contribution: s.contribution ?? null,
            weight: s.weight ?? null,
          })),
        },
      },
      select: { id: true },
    })

    return snapshot.id
  })
}

export async function getCurrentTheorySnapshot(personId: string) {
  return db.theorySnapshot.findFirst({
    where: { subjectPersonId: personId, status: THEORY_STATUS.current },
    orderBy: { version: "desc" },
    include: { sources: { orderBy: { createdAt: "asc" } } },
  })
}

export async function listTheorySnapshots(personId: string) {
  return db.theorySnapshot.findMany({
    where: { subjectPersonId: personId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      title: true,
      status: true,
      confidence: true,
      synthesizedAt: true,
      _count: { select: { sources: true } },
    },
  })
}

export async function getTheorySnapshotById(snapshotId: string) {
  return db.theorySnapshot.findUnique({
    where: { id: snapshotId },
    include: { sources: { orderBy: { createdAt: "asc" } } },
  })
}
