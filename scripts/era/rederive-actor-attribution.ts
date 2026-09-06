#!/usr/bin/env tsx
// Re-derive "whose money moved" from account ownership.
//
// Interaction.actorPersonId is a CACHE; EraAccountLink.ownerPersonId is the
// authoritative source (docs/FINANCE_INTERACTION_MODEL_PLAN.md §3). This is the
// repair script that guarantees the cache can never be wrong for long: run it
// after changing who owns an account, or on a schedule to detect drift.
//
// Usage:
//   npx tsx scripts/era/rederive-actor-attribution.ts --check     # report only
//   npx tsx scripts/era/rederive-actor-attribution.ts             # repair
//
// The attribution pass is a single SQL UPDATE, so it stays fast no matter how
// many transactions exist.

import fs from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
for (const candidate of [path.join(REPO_ROOT, ".env"), path.join(REPO_ROOT, "apps/persons/.env")]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const WORKSPACE_ID = "default-workspace"
const CHECK_ONLY = process.argv.includes("--check")
// Each attachContext() call is its own round trip, so fan out the per-row work.
const CONCURRENCY = 15

async function main() {
  const { db, attachContext } = await import("@life-os/db")

  const drift = await db.$queryRawUnsafe<{ n: number }[]>(`
    SELECT COUNT(*) AS n
      FROM "Interaction" i
      JOIN "EraAccountLink" a ON a."id" = i."accountLinkId"
     WHERE i."workspaceId" = $1
       AND a."ownerPersonId" IS NOT NULL
       AND (i."actorPersonId" IS NULL OR i."actorPersonId" <> a."ownerPersonId")`, WORKSPACE_ID)
  console.log(`Rows whose actor disagrees with their account owner: ${drift[0].n}`)

  if (CHECK_ONLY) {
    process.exitCode = drift[0].n > 0 ? 1 : 0
    return
  }

  // ── Personally-owned accounts: one statement, any scale ────────────────
  const updated = await db.$executeRawUnsafe(`
    UPDATE "Interaction"
       SET "actorPersonId" = (
             SELECT a."ownerPersonId" FROM "EraAccountLink" a WHERE a."id" = "Interaction"."accountLinkId")
     WHERE "workspaceId" = $1
       AND "accountLinkId" IS NOT NULL
       AND EXISTS (
             SELECT 1 FROM "EraAccountLink" a
              WHERE a."id" = "Interaction"."accountLinkId" AND a."ownerPersonId" IS NOT NULL)`, WORKSPACE_ID)
  console.log(`Attributed to a person: ${updated} row(s)`)

  // A shared account is NOT unowned. The card is in one person's name and they
  // are liable for it; a spouse also using it makes the spend joint, not
  // anonymous. So the owner attribution above applies to shared accounts too,
  // and the household edge below records the joint half. Clearing the actor
  // here — as this script used to — left every joint transaction belonging to
  // nobody, so "my spending" silently omitted the highest-volume card.

  // ── Shared accounts: attribute to the household Group ──────────────────
  const shared = await db.interaction.findMany({
    where: {
      workspaceId: WORKSPACE_ID,
      accountLink: { isShared: true, householdGroupId: { not: null } },
    },
    select: { id: true, accountLink: { select: { householdGroupId: true, eraAccountId: true } } },
  })
  console.log(`Shared-account rows to attribute to the household: ${shared.length}`)

  let attached = 0
  let unchanged = 0
  for (let i = 0; i < shared.length; i += CONCURRENCY) {
    const batch = shared.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(row =>
      attachContext(db, {
        interactionId: row.id,
        workspaceId: WORKSPACE_ID,
        entityType: "Group",
        entityId: row.accountLink!.householdGroupId!,
        role: "payer",
        band: "auto",
        source: "account-ownership",
        confidence: 1,
        evidence: { reason: "shared account", eraAccountId: row.accountLink!.eraAccountId },
      })))
    for (const result of results) {
      if (result.status === "unchanged" || result.status === "protected") unchanged += 1
      else attached += 1
    }
    if ((i + batch.length) % 150 === 0) console.log(`  ...${i + batch.length}/${shared.length}`)
  }
  console.log(`Household edges written: ${attached}, already correct: ${unchanged}`)

  const after = await db.$queryRawUnsafe<{ n: number }[]>(`
    SELECT COUNT(*) AS n
      FROM "Interaction" i
      JOIN "EraAccountLink" a ON a."id" = i."accountLinkId"
     WHERE i."workspaceId" = $1
       AND a."ownerPersonId" IS NOT NULL
       AND (i."actorPersonId" IS NULL OR i."actorPersonId" <> a."ownerPersonId")`, WORKSPACE_ID)
  console.log(`\nRemaining drift: ${after[0].n} (expected 0)`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
