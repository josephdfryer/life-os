#!/usr/bin/env tsx
// Era finance Phase 1 importer — loads Era account + transaction JSON dumps
// into the staging pipeline (see docs/ERA_FINANCE_INTEGRATION.md).
//
// Input directory layout:
//   <dir>/accounts.json          — output of accounts__list_financial_accounts
//   <dir>/transactions-*.json    — pages from transactions__list_transactions
//
// Usage:
//   npx tsx scripts/era/import-from-json.ts <dir>
//
// Idempotent: EraTransactionLink.eraTransactionId dedupes; re-runs skip
// already-imported transactions.

import fs from "node:fs"
import path from "node:path"
import { mirrorEraConnection } from "./connection-mirror"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")

for (const candidate of [
  path.join(REPO_ROOT, ".env"),
  path.join(REPO_ROOT, "apps/persons/.env"),
]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const WORKSPACE_ID = "default-workspace"
const TRANSFER_CATEGORY = "Transfers and card payments"

type EraAccount = {
  account_group_key: string
  name: string
  institution: string
  type: string
  balance?: { currency?: string }
}

type EraTransaction = {
  transaction_id: string
  account_group_key: string
  account_name?: string
  amount: number
  currency?: string
  description: string
  merchant_name?: string
  original_description?: string
  transaction_date: string
  posted_date?: string
  is_pending?: boolean
  category?: string
  category_key?: string
  is_cash_outflow?: boolean
}

async function main() {
  const dir = process.argv[2]
  if (!dir) {
    console.error("Usage: npx tsx scripts/era/import-from-json.ts <dir>")
    process.exit(1)
  }

  const { db } = await import("@life-os/db")

  // ── Connection (singleton per workspace/user) ────────────────
  const owner = await db.workspace.findUnique({
    where: { id: WORKSPACE_ID },
    select: {
      ownerUserId: true,
      members: {
        where: { status: "active" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { userId: true },
      },
    },
  })
  const userId = owner?.ownerUserId ?? owner?.members[0]?.userId
  if (!userId) throw new Error("No user found to own the Era connection")

  const connection = await db.$transaction(async tx => {
    const eraConnection = await tx.eraConnection.upsert({
      where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId } },
      update: { lastSyncedAt: new Date(), lastError: null },
      create: {
        workspaceId: WORKSPACE_ID,
        userId,
        status: "active",
        scope: "mcp:read (claude.ai session dump)",
        lastSyncedAt: new Date(),
      },
    })
    await mirrorEraConnection(tx, eraConnection)
    return eraConnection
  })
  console.log(`EraConnection: ${connection.id}`)

  // ── Accounts ─────────────────────────────────────────────────
  const accountsPath = path.join(dir, "accounts.json")
  const accountsById = new Map<string, string>() // eraAccountId -> accountLink.id
  if (fs.existsSync(accountsPath)) {
    const parsed = JSON.parse(fs.readFileSync(accountsPath, "utf8"))
    const accounts: EraAccount[] = parsed.accounts ?? parsed
    for (const account of accounts) {
      const link = await db.eraAccountLink.upsert({
        where: { workspaceId_eraAccountId: { workspaceId: WORKSPACE_ID, eraAccountId: account.account_group_key } },
        update: {
          institution: account.institution ?? null,
          accountName: account.name ?? null,
          accountType: account.type ?? null,
          currency: account.balance?.currency ?? "USD",
          lastSeenAt: new Date(),
        },
        create: {
          workspaceId: WORKSPACE_ID,
          connectionId: connection.id,
          eraAccountId: account.account_group_key,
          institution: account.institution ?? null,
          accountName: account.name ?? null,
          accountType: account.type ?? null,
          currency: account.balance?.currency ?? "USD",
          status: "active",
          lastSeenAt: new Date(),
        },
      })
      accountsById.set(account.account_group_key, link.id)
    }
    console.log(`Accounts upserted: ${accountsById.size}`)
  }

  // ── Transactions ─────────────────────────────────────────────
  const pageFiles = fs.readdirSync(dir).filter(f => f.startsWith("transactions-") && f.endsWith(".json")).sort()
  const transactions: EraTransaction[] = []
  for (const file of pageFiles) {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
    transactions.push(...(parsed.transactions ?? parsed))
  }
  console.log(`Transactions in dump: ${transactions.length} (${pageFiles.length} files)`)

  const ids = transactions.map(t => t.transaction_id)
  const existing = await db.eraTransactionLink.findMany({
    where: { workspaceId: WORKSPACE_ID, eraTransactionId: { in: ids } },
    select: { eraTransactionId: true },
  })
  const seen = new Set(existing.map(l => l.eraTransactionId))

  let staged = 0
  let skippedExisting = 0
  let transfers = 0

  for (const txn of transactions) {
    if (seen.has(txn.transaction_id)) {
      skippedExisting += 1
      continue
    }
    seen.add(txn.transaction_id)

    const isTransfer = txn.category === TRANSFER_CATEGORY
    const direction = txn.is_cash_outflow === false ? "received" : "paid"
    const amountAbs = Math.abs(txn.amount)
    const summary = `${txn.description} · $${amountAbs.toFixed(2)}${direction === "received" ? " received" : ""}`

    const stagedItem = await db.stagedInteraction.create({
      data: {
        workspaceId: WORKSPACE_ID,
        source: "era",
        sourceId: txn.transaction_id,
        itemType: "interaction",
        status: "pending",
        type: "financial",
        timestamp: new Date(txn.transaction_date),
        contactName: txn.description || null,
        summary,
        body: txn.original_description ?? txn.description,
        direction: isTransfer ? "transfer" : direction,
        priority: isTransfer ? 5 : 3,
        metadata: JSON.stringify({
          eraTransactionId: txn.transaction_id,
          eraAccountId: txn.account_group_key,
          accountName: txn.account_name,
          eraCategory: txn.category,
          eraCategoryKey: txn.category_key,
          rawAmount: txn.amount,
          amount: amountAbs,
          currency: txn.currency ?? "USD",
          merchantName: txn.merchant_name ?? null,
          rawDescription: txn.original_description ?? null,
          postedDate: txn.posted_date ?? null,
          transfer: isTransfer,
        }),
      },
    })

    await db.eraTransactionLink.create({
      data: {
        workspaceId: WORKSPACE_ID,
        connectionId: connection.id,
        accountLinkId: accountsById.get(txn.account_group_key) ?? null,
        eraTransactionId: txn.transaction_id,
        stagedItemId: stagedItem.id,
        status: "staged",
        lastSeenAt: new Date(),
      },
    })

    staged += 1
    if (isTransfer) transfers += 1
    if (staged % 100 === 0) console.log(`  staged ${staged}…`)
  }

  // Watermark: newest transaction date seen
  const newest = transactions.map(t => t.transaction_date).sort().at(-1)
  if (newest) {
    await db.$transaction(async tx => {
      const updated = await tx.eraConnection.update({
        where: { id: connection.id },
        data: { syncCursor: newest, lastSyncedAt: new Date() },
      })
      await mirrorEraConnection(tx, updated)
    })
  }

  console.log(`\nDone. Staged: ${staged} (${transfers} transfers at low priority) · already imported: ${skippedExisting}`)
  console.log(`Sync watermark: ${newest}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
