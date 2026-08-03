#!/usr/bin/env tsx
// One-time household + account-ownership setup for finance-as-interactions.
// See docs/FINANCE_INTERACTION_MODEL_PLAN.md §3.
//
// Ownership is declared ONCE per account, never per transaction. Everything
// downstream ("mine", "hers", "ours") derives from these few rows.
//
// Steps, each independently idempotent:
//   1. Merge the duplicate Qin person records, keeping the married-name record.
//   2. Record the marriage on the surviving person's notes.
//   3. Create the household Group and add Joseph + Qin as members.
//   4. Set ownerPersonId / isShared on every EraAccountLink.
//
// Run from apps/persons so the "@/" path alias resolves:
//   cd apps/persons && npx tsx scripts/setup-household-finance.ts [--dry-run]
//
// Afterwards re-run the backfill to stamp actorPersonId onto interactions:
//   npx tsx scripts/era/backfill-staged-to-interactions.ts

import fs from "node:fs"
import path from "node:path"

const APP_ROOT = path.resolve(import.meta.dirname, "..")
const REPO_ROOT = path.resolve(APP_ROOT, "../..")

for (const candidate of [path.join(REPO_ROOT, ".env"), path.join(APP_ROOT, ".env")]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}
delete process.env.TURSO_SYNC_URL

const WORKSPACE_ID = "default-workspace"
const DRY_RUN = process.argv.includes("--dry-run")

const JOSEPH_ID = "cmr9gi8eb008104lek5io7qoa"       // Joseph Fryer, jdf247@gmail.com
const QIN_KEEP_ID = "cmr9i6o8x00id04l4tmvrfgfr"     // Qin Fryer (married name, has email)
const QIN_DELETE_ID = "cmr9h2exj00rk04l428eii5ds"   // Qin Ding (maiden name, duplicate)

const HOUSEHOLD_NAME = "Fryer household"
const MARRIAGE_NOTE = "Married Joseph Fryer on January 22, 2023; formerly Qin Ding."

// Era account_group_key -> who it belongs to.
// "shared" attributes to the household Group rather than falsely to one spouse.
const ACCOUNT_OWNERSHIP: Record<string, "joseph" | "shared"> = {
  uagr_9pBYqjyRTzX: "shared", // American Express Platinum — both spend on it
}
const DEFAULT_OWNER = "joseph" as const

async function main() {
  const { db } = await import("@life-os/db")
  const { mergePersons } = await import("@/server/domain/merge")

  console.log(DRY_RUN ? "DRY RUN — no writes\n" : "LIVE RUN\n")

  // ── 1. Merge the duplicate Qin records ────────────────────────────────
  const [keep, loser] = await Promise.all([
    db.person.findUnique({ where: { id: QIN_KEEP_ID }, select: { id: true, first: true, last: true, notes: true } }),
    db.person.findUnique({ where: { id: QIN_DELETE_ID }, select: { id: true, first: true, last: true } }),
  ])
  if (!keep) throw new Error(`Keeper person ${QIN_KEEP_ID} not found — refusing to guess`)

  if (loser) {
    console.log(`Merging "${loser.first} ${loser.last}" -> "${keep.first} ${keep.last}"`)
    if (!DRY_RUN) {
      // Canonical merge: reassigns interactions, plans, staged rows, financial
      // attribution and account ownership, then deletes the loser.
      await mergePersons({ keepId: QIN_KEEP_ID, deleteId: QIN_DELETE_ID }, WORKSPACE_ID)
    }
  } else {
    console.log(`Merge already done — ${QIN_DELETE_ID} no longer exists.`)
  }

  // ── 2. Record the marriage on the surviving person ────────────────────
  const current = await db.person.findUnique({ where: { id: QIN_KEEP_ID }, select: { notes: true } })
  if (current && !(current.notes ?? "").includes("January 22, 2023")) {
    const notes = current.notes ? `${current.notes.trim()}\n\n${MARRIAGE_NOTE}` : MARRIAGE_NOTE
    console.log(`Adding marriage note to ${QIN_KEEP_ID}`)
    if (!DRY_RUN) await db.person.update({ where: { id: QIN_KEEP_ID }, data: { notes } })
  } else {
    console.log("Marriage note already present.")
  }

  // ── 3. Household group ────────────────────────────────────────────────
  let household = await db.group.findFirst({
    where: { workspaceId: WORKSPACE_ID, name: HOUSEHOLD_NAME, groupType: "family" },
    select: { id: true },
  })
  if (!household) {
    console.log(`Creating Group "${HOUSEHOLD_NAME}"`)
    if (!DRY_RUN) {
      household = await db.group.create({
        data: {
          workspaceId: WORKSPACE_ID,
          name: HOUSEHOLD_NAME,
          groupType: "family",
          notes: "The family unit for shared finances. Joint accounts attribute here rather than to one spouse.",
        },
        select: { id: true },
      })
    }
  } else {
    console.log(`Group "${HOUSEHOLD_NAME}" already exists (${household.id}).`)
  }

  if (household) {
    for (const [personId, role] of [[JOSEPH_ID, "self"], [QIN_KEEP_ID, "spouse"]] as const) {
      const existing = await db.personGroup.findFirst({ where: { personId, groupId: household.id } })
      if (existing) {
        console.log(`  member ${role} already present.`)
        continue
      }
      console.log(`  adding member ${role} (${personId})`)
      if (!DRY_RUN) await db.personGroup.create({ data: { personId, groupId: household.id, role } })
    }
  }

  // ── 4. Account ownership ──────────────────────────────────────────────
  const accounts = await db.eraAccountLink.findMany({
    where: { workspaceId: WORKSPACE_ID },
    select: { id: true, eraAccountId: true, institution: true, accountName: true, ownerPersonId: true, isShared: true },
    orderBy: { accountName: "asc" },
  })

  console.log(`\nAccounts (${accounts.length}):`)
  for (const account of accounts) {
    const intent = ACCOUNT_OWNERSHIP[account.eraAccountId] ?? DEFAULT_OWNER
    const data = intent === "shared"
      ? { ownerPersonId: null, isShared: true, householdGroupId: household?.id ?? null }
      : { ownerPersonId: JOSEPH_ID, isShared: false, householdGroupId: null }

    const label = `${(account.institution ?? "").padEnd(28)} ${account.accountName ?? ""}`.trim()
    console.log(`  ${intent === "shared" ? "household" : "joseph   "}  ${label}`)
    if (!DRY_RUN) await db.eraAccountLink.update({ where: { id: account.id }, data })
  }

  console.log("\nDone.")
  if (!DRY_RUN) {
    console.log("Next: npx tsx scripts/era/backfill-staged-to-interactions.ts   (from the repo root)")
    console.log("      — re-derives actorPersonId onto every financial Interaction.")
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
