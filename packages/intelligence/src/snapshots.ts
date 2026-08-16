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
            evidenceClaimId: s.evidenceClaimId ?? null,
            evidenceClassification: s.evidenceClassification ?? null,
            evidenceStatus: s.evidenceStatus ?? null,
            citation: s.citation ? JSON.stringify(s.citation) : null,
          })),
        },
      },
      select: { id: true },
    })

    return snapshot.id
  })
}

// workspaceId defaults for backward compatibility with existing callers that
// pre-date this check (Persons' theory page independently verified the
// Person belongs to the caller's workspace before ever reaching here, so
// this was masked rather than exploitable there) — but every new caller
// should pass it explicitly. Without it, any caller that knows a personId
// could read another workspace's Theory of Person data, since Person ids
// are globally unique cuids, not scoped by their own shape.
export async function getCurrentTheorySnapshot(personId: string, workspaceId?: string) {
  return db.theorySnapshot.findFirst({
    where: { subjectPersonId: personId, status: THEORY_STATUS.current, ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { version: "desc" },
    include: { sources: { orderBy: { createdAt: "asc" } } },
  })
}

export async function listTheorySnapshots(personId: string, workspaceId?: string) {
  return db.theorySnapshot.findMany({
    where: { subjectPersonId: personId, ...(workspaceId ? { workspaceId } : {}) },
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

export async function getTheorySnapshotById(snapshotId: string, workspaceId?: string) {
  return db.theorySnapshot.findFirst({
    where: { id: snapshotId, ...(workspaceId ? { workspaceId } : {}) },
    include: { sources: { orderBy: { createdAt: "asc" } } },
  })
}
