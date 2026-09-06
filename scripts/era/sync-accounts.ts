#!/usr/bin/env tsx
// Upsert Era financial accounts into EraAccountLink.
//
// Accounts are the ownership anchor (docs/FINANCE_INTERACTION_MODEL_PLAN.md §3):
// whose money a transaction represents is derived from which account it hit. So
// this must run BEFORE importing transactions, or rows land unattributed.
//
// Input: a JSON file from accounts__list_financial_accounts (an object with an
// `accounts` array, or a bare array).
//
//   npx tsx scripts/era/sync-accounts.ts <accounts.json> [--dry-run]
//
// CRITICAL: never overwrites ownerPersonId / isShared / householdGroupId. Those
// are human decisions; a sync that clobbered them would silently re-attribute
// every future transaction. Balances are never stored — they are a live value
// (accounts__check_account_balance), and storing them would be a stale aggregate.

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
const DRY_RUN = process.argv.includes("--dry-run")

type EraAccount = {
  account_group_key: string
  name?: string
  institution?: string
  type?: string
  balance?: { currency?: string }
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error("Usage: npx tsx scripts/era/sync-accounts.ts <accounts.json> [--dry-run]")
    process.exit(1)
  }

  const { db } = await import("@life-os/db")
  console.log(DRY_RUN ? "DRY RUN — no writes\n" : "LIVE RUN\n")

  const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
  const accounts: EraAccount[] = parsed.accounts ?? parsed
  console.log(`Accounts in payload: ${accounts.length}`)

  const connection = await db.eraConnection.findFirst({
    where: { workspaceId: WORKSPACE_ID },
    select: { id: true },
  })
  if (!connection) throw new Error("No EraConnection — run the initial import first")

  let created = 0
  let updated = 0

  for (const account of accounts) {
    const existing = await db.eraAccountLink.findUnique({
      where: { workspaceId_eraAccountId: { workspaceId: WORKSPACE_ID, eraAccountId: account.account_group_key } },
      select: { id: true, ownerPersonId: true, isShared: true },
    })

    // Descriptive fields only. Ownership is deliberately absent from this object.
    const descriptive = {
      institution: account.institution?.trim() || null,
      accountName: account.name?.trim() || null,
      accountType: account.type ?? null,
      currency: account.balance?.currency ?? "USD",
      lastSeenAt: new Date(),
    }

    const label = `${(account.institution ?? "").trim().padEnd(28)} ${account.name ?? ""}`.trim()
    if (existing) {
      console.log(`  update  ${label}`)
      if (!DRY_RUN) await db.eraAccountLink.update({ where: { id: existing.id }, data: descriptive })
      updated += 1
    } else {
      console.log(`  CREATE  ${label}   <- new account, needs an owner`)
      if (!DRY_RUN) {
        await db.eraAccountLink.create({
          data: {
            workspaceId: WORKSPACE_ID,
            connectionId: connection.id,
            eraAccountId: account.account_group_key,
            status: "active",
            ...descriptive,
          },
        })
      }
      created += 1
    }
  }

  console.log(`\nCreated ${created}, updated ${updated}.`)

  if (!DRY_RUN) {
    const orphans = await db.eraAccountLink.findMany({
      where: { workspaceId: WORKSPACE_ID, ownerPersonId: null, isShared: false },
      select: { eraAccountId: true, institution: true, accountName: true },
    })
    if (orphans.length > 0) {
      console.log(`\n${orphans.length} account(s) have no owner — transactions on them cannot be attributed:`)
      for (const o of orphans) console.log(`  ${o.eraAccountId}  ${o.institution ?? ""} ${o.accountName ?? ""}`)
      console.log(`\nSet ownership in apps/persons/scripts/setup-household-finance.ts, then run:`)
      console.log(`  npx tsx scripts/era/rederive-actor-attribution.ts`)
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
