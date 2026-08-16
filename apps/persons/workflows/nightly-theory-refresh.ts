import { db } from "@life-os/db"
import { regenerateTheory } from "@life-os/intelligence"
import { fileIntelligenceFlags, getTheoryEvidenceState, listStaleTheoryPeoplePage } from "@life-os/files"

const PAGE_SIZE = 100

export async function nightlyTheoryRefreshWorkflow() {
  "use workflow"
  console.log("[nightly-theory] starting")
  if (!(await nightlyEnabled())) return { status: "disabled", regenerated: 0 }
  const budget = await nightlyBudget()
  let regenerated = 0
  let attempted = 0
  let workspaceCursor: string | null = null
  do {
    const workspacePage = await listWorkspacePage(workspaceCursor)
    for (const workspaceId of workspacePage.ids) {
      let personCursor: string | null = null
      do {
        const page = await listStalePersonPage(workspaceId, personCursor)
        for (const personId of page.personIds) {
          if (attempted >= budget) return { status: "budget_reached", regenerated, attempted }
          attempted += 1
          if (await regenerateStalePerson(personId, workspaceId)) regenerated += 1
        }
        personCursor = page.nextCursor
      } while (personCursor)
    }
    workspaceCursor = workspacePage.nextCursor
  } while (workspaceCursor)
  console.log("[nightly-theory] complete", regenerated)
  return { status: "complete", regenerated, attempted }
}

async function nightlyEnabled() {
  "use step"
  console.log("[nightly-theory] checking feature flag")
  return fileIntelligenceFlags().nightlyTheory
}

async function nightlyBudget() {
  "use step"
  const value = Number(process.env.FILE_INTELLIGENCE_NIGHTLY_MAX_PEOPLE ?? 25)
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 25
}

async function listWorkspacePage(cursor: string | null) {
  "use step"
  console.log("[nightly-theory] workspace page", cursor)
  const rows = await db.workspace.findMany({
    where: { status: "active", ...(cursor ? { id: { gt: cursor } } : {}) },
    orderBy: { id: "asc" }, take: PAGE_SIZE,
    select: { id: true },
  })
  return { ids: rows.map(row => row.id), nextCursor: rows.length === PAGE_SIZE ? rows.at(-1)!.id : null }
}

async function listStalePersonPage(workspaceId: string, cursor: string | null) {
  "use step"
  console.log("[nightly-theory] person page", workspaceId, cursor)
  return listStaleTheoryPeoplePage(workspaceId, cursor, PAGE_SIZE)
}

async function regenerateStalePerson(personId: string, workspaceId: string) {
  "use step"
  console.log("[nightly-theory] regenerate", workspaceId, personId)
  if (!(await getTheoryEvidenceState(personId, workspaceId)).stale) return false
  try {
    await regenerateTheory(personId, workspaceId)
    return true
  } catch (error) {
    console.error("[nightly-theory] person failed", personId, error)
    return false
  }
}
