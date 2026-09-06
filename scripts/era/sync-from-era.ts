#!/usr/bin/env tsx
// Headless Era sync — pages the Era Context MCP server over HTTP and writes
// each page to a dump directory for scripts/era/import-transactions.ts.
//
// Why a direct client rather than the MCP tools in a chat session: a 5,568-row
// backfill cannot go through a conversation, because each page is ~50KB and
// lands unpredictably in the model's context. This runs unattended.
//
// Usage:
//   npx tsx scripts/era/sync-from-era.ts                 # incremental (watermark)
//   npx tsx scripts/era/sync-from-era.ts --full          # everything Era has
//   npx tsx scripts/era/sync-from-era.ts --from 2026-01-01 --to 2026-03-31
//   npx tsx scripts/era/sync-from-era.ts --accounts-only
//   npx tsx scripts/era/sync-from-era.ts --out /tmp/era  # keep the raw dump
//
// Credentials: ERA_API_KEY from the environment, falling back to the encrypted
// key on EraConnection. The key is never logged.
//
// Incremental runs start from EraConnection.syncCursor minus a lookback window,
// because transactions post days after they occur; dedupe on the transaction id
// makes the overlap free.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { mirrorEraConnection } from "./connection-mirror"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
for (const candidate of [path.join(REPO_ROOT, ".env"), path.join(REPO_ROOT, "apps/persons/.env")]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const WORKSPACE_ID = "default-workspace"
const ERA_MCP_URL = process.env.ERA_MCP_URL ?? "https://context.era.app/mcp"
const PAGE_SIZE = 100
// Late-posting window: a transaction dated the 1st can appear on the 6th.
const LOOKBACK_DAYS = 5
const MAX_RETRIES = 4

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main() {
  const { db } = await import("@life-os/db")

  const connection = await db.eraConnection.findFirst({
    where: { workspaceId: WORKSPACE_ID },
    select: { id: true, syncCursor: true, accessTokenEncrypted: true },
  })
  if (!connection) throw new Error("No EraConnection for this workspace")

  const apiKey = await resolveApiKey(connection.accessTokenEncrypted)
  const call = makeClient(apiKey)

  const outDir = value("out") ?? fs.mkdtempSync(path.join(os.tmpdir(), "era-sync-"))
  fs.mkdirSync(outDir, { recursive: true })
  console.log(`Dump directory: ${outDir}`)

  // ── Accounts ──────────────────────────────────────────────────────────
  const accounts = await call("accounts__list_financial_accounts", { include_hidden: true })
  const accountsPath = path.join(outDir, "accounts.json")
  fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 1))
  console.log(`Accounts: ${accounts.accounts?.length ?? 0} -> accounts.json`)

  if (flag("accounts-only")) {
    console.log(`\nNext: npx tsx scripts/era/sync-accounts.ts ${accountsPath}`)
    return
  }

  // ── Date window ───────────────────────────────────────────────────────
  const fromDate = flag("full")
    ? undefined
    : value("from") ?? watermark(connection.syncCursor)
  const toDate = value("to")
  console.log(`Window: ${fromDate ?? "all history"}${toDate ? ` -> ${toDate}` : ""}`)

  // ── Transactions ──────────────────────────────────────────────────────
  let page = 1
  let totalPages = 1
  let fetched = 0
  let newestDate: string | undefined

  while (page <= totalPages) {
    const result = await call("transactions__list_transactions", {
      page,
      page_size: PAGE_SIZE,
      ...(fromDate ? { from_date: fromDate } : {}),
      ...(toDate ? { to_date: toDate } : {}),
    })

    const rows: { transaction_date?: string }[] = result.transactions ?? []
    totalPages = result.pagination?.total_pages ?? 1
    const totalItems = result.pagination?.total_items ?? rows.length

    fs.writeFileSync(
      path.join(outDir, `transactions-${String(page).padStart(4, "0")}.json`),
      JSON.stringify(result, null, 1),
    )
    fetched += rows.length

    for (const row of rows) {
      if (row.transaction_date && (!newestDate || row.transaction_date > newestDate)) {
        newestDate = row.transaction_date
      }
    }

    console.log(`  page ${page}/${totalPages} — ${rows.length} rows (${fetched}/${totalItems})`)
    if (result.history_window_applied) {
      console.warn(`  ! Era clamped history to a rolling window — older rows withheld by plan tier`)
    }
    page += 1
  }

  console.log(`\nFetched ${fetched} transaction(s) across ${totalPages} page(s).`)

  // Advance the watermark only after every page landed on disk, so an
  // interrupted run re-fetches rather than skipping a gap.
  if (newestDate) {
    await db.$transaction(async tx => {
      const updated = await tx.eraConnection.update({
        where: { id: connection.id },
        data: { syncCursor: newestDate, lastSyncedAt: new Date(), lastError: null },
      })
      await mirrorEraConnection(tx, updated)
    })
    console.log(`Watermark advanced to ${newestDate}`)
  }

  console.log(`\nNext:`)
  console.log(`  npx tsx scripts/era/sync-accounts.ts ${accountsPath}`)
  console.log(`  npx tsx scripts/era/import-transactions.ts ${outDir}`)
  console.log(`  npx tsx scripts/era/rederive-actor-attribution.ts`)
}

/** ERA_API_KEY wins; otherwise decrypt the key stored on the connection. */
async function resolveApiKey(encrypted: string | null) {
  const fromEnv = process.env.ERA_API_KEY?.trim()
  if (fromEnv) return fromEnv
  if (!encrypted) throw new Error("No ERA_API_KEY in env and no stored key on EraConnection")
  const { decrypt } = await import("@life-os/db/crypto")
  return decrypt(encrypted)
}

type McpResult = {
  transactions?: { transaction_date?: string }[]
  accounts?: unknown[]
  pagination?: { total_pages?: number; total_items?: number }
  history_window_applied?: boolean
}

function makeClient(apiKey: string) {
  let id = 0
  return async function call(tool: string, args: Record<string, unknown>): Promise<McpResult> {
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(ERA_MCP_URL, {
          method: "POST",
          headers: {
            // Never log this header.
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: (id += 1),
            method: "tools/call",
            params: { name: tool, arguments: args },
          }),
          signal: AbortSignal.timeout(60_000),
        })

        if (response.status === 401 || response.status === 403) {
          throw new Error(`Era rejected the API key (HTTP ${response.status}) — check ERA_API_KEY`)
        }
        // Back off on rate limits and transient server errors; fail fast on the rest.
        if (response.status === 429 || response.status >= 500) {
          throw Object.assign(new Error(`Era HTTP ${response.status}`), { retryable: true })
        }
        if (!response.ok) throw new Error(`Era HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)

        const envelope = parseEnvelope(await response.text())
        if (envelope.error) throw new Error(`Era tool error: ${JSON.stringify(envelope.error).slice(0, 300)}`)

        // Tool payloads arrive as a JSON string inside content[0].text.
        const text = envelope.result?.content?.[0]?.text
        if (typeof text !== "string") throw new Error(`Unexpected Era response shape for ${tool}`)
        return JSON.parse(text) as McpResult
      } catch (error) {
        lastError = error
        const retryable = (error as { retryable?: boolean }).retryable
          || (error as Error).name === "TimeoutError"
        if (!retryable || attempt === MAX_RETRIES) break
        const delay = 500 * 2 ** (attempt - 1)
        console.warn(`  retry ${attempt}/${MAX_RETRIES - 1} after ${delay}ms (${(error as Error).message})`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    throw lastError
  }
}

// Streamable HTTP may answer as an SSE stream even when we asked for JSON.
function parseEnvelope(body: string): { result?: { content?: { text?: string }[] }; error?: unknown } {
  const trimmed = body.trim()
  if (trimmed.startsWith("{")) return JSON.parse(trimmed)
  for (const line of trimmed.split("\n")) {
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim()
      if (payload && payload !== "[DONE]") return JSON.parse(payload)
    }
  }
  throw new Error(`Could not parse Era response: ${trimmed.slice(0, 200)}`)
}

/** Re-fetch a few days before the watermark; dedupe makes the overlap free. */
function watermark(cursor: string | null) {
  if (!cursor) return undefined
  const date = new Date(`${cursor.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return undefined
  date.setUTCDate(date.getUTCDate() - LOOKBACK_DAYS)
  return date.toISOString().slice(0, 10)
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message ?? e); process.exit(1) })
