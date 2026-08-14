import { db } from "@life-os/db"
import { getTheoryEvidenceState } from "./queries"

export async function listStaleTheoryPeoplePage(workspaceId: string, cursor: string | null, pageSize = 100) {
  const safePageSize = Math.min(500, Math.max(1, Math.floor(pageSize)))
  const rows = await db.person.findMany({
    where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) },
    orderBy: { id: "asc" }, take: safePageSize,
    select: { id: true },
  })
  const states = await Promise.all(rows.map(async row => ({ id: row.id, stale: (await getTheoryEvidenceState(row.id, workspaceId)).stale })))
  return {
    personIds: states.filter(row => row.stale).map(row => row.id),
    nextCursor: rows.length === safePageSize ? rows.at(-1)!.id : null,
  }
}

export function theoryBudgetAllowsAttempt(attempted: number, budget: number) {
  return attempted < Math.max(1, Math.floor(budget))
}
