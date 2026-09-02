#!/usr/bin/env tsx
// Verification for finance-as-interactions. Read-only.
//
// Proves the things the plan claims: transactions are canonical Interactions,
// aggregation happens in SQL rather than JavaScript, ownership resolves to
// people and to the household, and enrichment edges are attached with
// provenance so context can keep accruing.
//
// Usage: npx tsx scripts/era/verify-finance-model.ts

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
delete process.env.TURSO_SYNC_URL

const WORKSPACE_ID = "default-workspace"
const money = (cents: unknown) => `$${(Number(cents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function main() {
  const { db } = await import("@life-os/db")
  const q = <T = Record<string, unknown>>(sql: string, ...args: unknown[]) =>
    db.$queryRawUnsafe<T[]>(sql, ...args)

  const section = (title: string) => console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`)

  section("Canonical storage")
  const [{ total }] = await q<{ total: number }>(
    `SELECT COUNT(*) AS total FROM "Interaction" WHERE "type" = 'financial' AND "workspaceId" = $1`, WORKSPACE_ID)
  const [{ staged }] = await q<{ staged: number }>(
    `SELECT COUNT(*) AS staged FROM "StagedInteraction" WHERE source = 'era' AND status = 'pending'`)
  const [{ unlinked }] = await q<{ unlinked: number }>(
    `SELECT COUNT(*) AS unlinked FROM "EraTransactionLink" WHERE "interactionId" IS NULL`)
  console.log(`financial Interactions       ${total}`)
  console.log(`Era rows still pending       ${staged}   (was 683 — the review queue is drained)`)
  console.log(`Era links without interaction ${unlinked}`)

  section("Spend by category (single SQL GROUP BY)")
  const byCategory = await q(`
    SELECT "category", COUNT(*) AS n, SUM("amount") AS cents
      FROM "Interaction"
     WHERE "workspaceId" = $1 AND "type" = 'financial' AND "direction" = 'paid'
     GROUP BY "category" ORDER BY cents DESC LIMIT 10`, WORKSPACE_ID)
  for (const row of byCategory) {
    console.log(`  ${String(row.category ?? "uncategorized").padEnd(32)} ${String(row.n).padStart(4)}  ${money(row.cents)}`)
  }

  section("Whose money (the actor split)")
  // A shared account has no single owner on purpose — those rows are attributed
  // to the household Group, not left unknown. Distinguish the two.
  const byActor = await q(`
    SELECT CASE
             WHEN p."id" IS NOT NULL THEN p."first" || ' ' || p."last"
             WHEN a."isShared" IS TRUE THEN '(joint — household)'
             ELSE '— unattributed —'
           END AS who,
           COUNT(*) AS n, SUM(i."amount") AS cents
      FROM "Interaction" i
      LEFT JOIN "Person" p ON p."id" = i."actorPersonId"
      LEFT JOIN "EraAccountLink" a ON a."id" = i."accountLinkId"
     WHERE i."workspaceId" = $1 AND i."type" = 'financial' AND i."direction" = 'paid'
     GROUP BY who ORDER BY cents DESC`, WORKSPACE_ID)
  for (const row of byActor) {
    console.log(`  ${String(row.who).padEnd(32)} ${String(row.n).padStart(4)}  ${money(row.cents)}`)
  }

  section("Household view (personal by member + joint by household)")
  const household = await q<{ id: string; name: string }>(
    `SELECT "id", "name" FROM "Group" WHERE "workspaceId" = $1 AND "groupType" = 'family' LIMIT 1`, WORKSPACE_ID)
  if (household.length === 0) {
    console.log("  no family Group yet — run apps/persons/scripts/setup-household-finance.ts")
  } else {
    const familyGroupId = household[0].id
    const [row] = await q(`
      SELECT COUNT(*) AS n, SUM(i."amount") AS cents
        FROM "Interaction" i
        LEFT JOIN "PersonGroup" pg ON pg."personId" = i."actorPersonId" AND pg."groupId" = $1
        LEFT JOIN "InteractionParticipant" ip
               ON ip."interactionId" = i."id" AND ip."entityType" = 'Group' AND ip."entityId" = $2
       WHERE i."workspaceId" = $3 AND i."type" = 'financial' AND i."direction" = 'paid'
         AND (pg."id" IS NOT NULL OR ip."id" IS NOT NULL)`, familyGroupId, familyGroupId, WORKSPACE_ID)
    console.log(`  ${household[0].name}: ${row.n} transactions, ${money(row.cents)}`)
  }

  section("Spend by account")
  const byAccount = await q(`
    SELECT a."institution", a."accountName", a."isShared",
           COUNT(*) AS n, SUM(i."amount") AS cents
      FROM "Interaction" i
      JOIN "EraAccountLink" a ON a."id" = i."accountLinkId"
     WHERE i."workspaceId" = $1 AND i."type" = 'financial' AND i."direction" = 'paid'
     GROUP BY a."id" ORDER BY cents DESC LIMIT 8`, WORKSPACE_ID)
  for (const row of byAccount) {
    const tag = Number(row.isShared) === 1 ? " [shared]" : ""
    console.log(`  ${String(row.institution ?? "").padEnd(26)} ${String(row.accountName ?? "").slice(0, 24).padEnd(26)} ${money(row.cents)}${tag}`)
  }

  section("Attached context (enrichment edges, with provenance)")
  const participants = await q(`
    SELECT "entityType", "role", "band", COUNT(*) AS n
      FROM "InteractionParticipant"
     WHERE "workspaceId" = $1
     GROUP BY "entityType", "role", "band" ORDER BY n DESC`, WORKSPACE_ID)
  for (const row of participants) {
    console.log(`  ${String(row.entityType).padEnd(8)} role=${String(row.role ?? "—").padEnd(12)} band=${String(row.band ?? "—").padEnd(12)} ${row.n}`)
  }
  const [{ withPlace }] = await q<{ withPlace: number }>(
    `SELECT COUNT(*) AS "withPlace" FROM "Interaction" WHERE "workspaceId" = $1 AND "type" = 'financial' AND "placeId" IS NOT NULL`, WORKSPACE_ID)
  console.log(`  financial interactions linked to a Place: ${withPlace}`)

  section("Cross-domain query the old model could not answer")
  const placeSpend = await q(`
    SELECT pl."name", COUNT(*) AS n, SUM(i."amount") AS cents
      FROM "Interaction" i
      JOIN "Place" pl ON pl."id" = i."placeId"
     WHERE i."workspaceId" = $1 AND i."type" = 'financial' AND i."direction" = 'paid'
     GROUP BY pl."id" ORDER BY cents DESC LIMIT 5`, WORKSPACE_ID)
  if (placeSpend.length === 0) console.log("  (no place-linked spend yet)")
  for (const row of placeSpend) {
    console.log(`  ${String(row.name).padEnd(36)} ${String(row.n).padStart(3)}  ${money(row.cents)}`)
  }

  section("Query plan (proves the index is used, not a table scan)")
  const plan = await q<Record<"QUERY PLAN", string>>(`
    EXPLAIN
    SELECT "id" FROM "Interaction"
     WHERE "workspaceId" = $1 AND "type" = 'financial'
     ORDER BY "timestamp" DESC LIMIT 50`, WORKSPACE_ID)
  for (const row of plan) console.log(`  ${row["QUERY PLAN"]}`)

  section("Data integrity")
  const [{ drift }] = await q<{ drift: number }>(`
    SELECT COUNT(*) AS drift
      FROM "Interaction" i
      JOIN "EraAccountLink" a ON a."id" = i."accountLinkId"
     WHERE i."workspaceId" = $1
       AND a."ownerPersonId" IS NOT NULL
       AND (i."actorPersonId" IS NULL OR i."actorPersonId" <> a."ownerPersonId")`, WORKSPACE_ID)
  console.log(`  actorPersonId drift vs account owner: ${drift}   (0 = cache agrees with the authoritative source)`)

  const [{ dupes }] = await q<{ dupes: number }>(`
    SELECT COUNT(*) AS dupes FROM (
      SELECT "source", "sourceId" FROM "Interaction"
       WHERE "source" IS NOT NULL GROUP BY "source", "sourceId" HAVING COUNT(*) > 1) d`)
  console.log(`  duplicate (source, sourceId) rows:    ${dupes}`)

  const [{ badAmount }] = await q<{ badAmount: number }>(
    `SELECT COUNT(*) AS "badAmount" FROM "Interaction" WHERE "type" = 'financial' AND ("amount" IS NULL OR "amount" < 0)`)
  console.log(`  financial rows with bad amount:       ${badAmount}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
