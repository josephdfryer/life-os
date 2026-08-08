import { THEORY_STATUS } from "./types"
import type { LifeModelSynthesis } from "./types"

const DEFAULT_WORKSPACE = process.env.THEORY_WORKSPACE_ID ?? "default-workspace"

// Persist a whole-life synthesis as a new append-only snapshot. Same
// versioning rule as createTheorySnapshot in snapshots.ts: never overwrite —
// find max version, create version + 1 as the new `current`, archive the
// prior `current`, all in one transaction.
export async function createLifeModelSnapshot(
  workspaceId: string = DEFAULT_WORKSPACE,
  synthesis: LifeModelSynthesis,
): Promise<string> {
  const { db } = await import("@life-os/db")
  return db.$transaction(async tx => {
    const latest = await tx.lifeModelSnapshot.findFirst({
      where: { workspaceId },
      orderBy: { version: "desc" },
      select: { version: true },
    })
    const nextVersion = (latest?.version ?? 0) + 1

    await tx.lifeModelSnapshot.updateMany({
      where: { workspaceId, status: THEORY_STATUS.current },
      data: { status: THEORY_STATUS.archived },
    })

    const snapshot = await tx.lifeModelSnapshot.create({
      data: {
        workspaceId,
        version: nextVersion,
        summary: synthesis.summary,
        status: THEORY_STATUS.current,
        modelId: synthesis.modelId ?? null,
        promptVersion: synthesis.promptVersion ?? null,
        claims: {
          create: synthesis.claims.map(claim => ({
            kind: claim.kind,
            statement: claim.statement,
            confidence: claim.confidence,
            subjectType: claim.subjectType,
            subjectId: claim.subjectId,
            windowStart: claim.windowStart ?? null,
            windowEnd: claim.windowEnd ?? null,
            evidence: claim.evidence.length ? JSON.stringify(claim.evidence) : null,
          })),
        },
      },
      select: { id: true },
    })

    if (synthesis.analysisRunId) {
      const linked = await tx.lifeModelAnalysisRun.updateMany({
        where: { id: synthesis.analysisRunId, workspaceId },
        data: { snapshotId: snapshot.id },
      })
      if (linked.count !== 1) throw new Error("Life-model analysis run was not found in this workspace.")
    }

    return snapshot.id
  })
}

export async function getCurrentLifeModelSnapshot(workspaceId: string = DEFAULT_WORKSPACE) {
  const { db } = await import("@life-os/db")
  return db.lifeModelSnapshot.findFirst({
    where: { workspaceId, status: THEORY_STATUS.current },
    orderBy: { version: "desc" },
    include: { claims: { orderBy: { createdAt: "asc" }, include: { feedback: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  })
}

export async function listLifeModelSnapshots(workspaceId: string = DEFAULT_WORKSPACE) {
  const { db } = await import("@life-os/db")
  return db.lifeModelSnapshot.findMany({
    where: { workspaceId },
    orderBy: { version: "desc" },
    take: 50,
    select: {
      id: true,
      version: true,
      summary: true,
      status: true,
      modelId: true,
      promptVersion: true,
      synthesizedAt: true,
      _count: { select: { claims: true } },
    },
  })
}

export async function getLifeModelSnapshotById(snapshotId: string, workspaceId: string = DEFAULT_WORKSPACE) {
  const { db } = await import("@life-os/db")
  return db.lifeModelSnapshot.findFirst({
    where: { id: snapshotId, workspaceId },
    include: { claims: { orderBy: { createdAt: "asc" }, include: { feedback: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  })
}
