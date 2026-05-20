#!/usr/bin/env tsx

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import type { CaptureState } from "../synthesis/types"

const require = createRequire(import.meta.url)
const Database = require("better-sqlite3") as new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean }
) => BetterSqliteDatabase
const dotenv = require("dotenv") as { config(options: { path: string; quiet?: boolean }): void }
loadEnv()

type BetterSqliteDatabase = {
  pragma(sql: string): unknown
  prepare<TParams extends unknown[] = unknown[], TResult = unknown>(sql: string): {
    all(...params: TParams): TResult[]
  }
  close(): void
}

type CallRow = {
  id: number
  address: string | null
  duration: number | null
  appleDate: number | null
  originated: number | null
  answered: number | null
  serviceProvider: string | null
  displayName: string | null
}

type ArchiveRecord = {
  id: number
  address: string
  displayName: string
  timestamp: string
  durationSeconds: number
  originated: boolean
  answered: boolean
  serviceProvider: string
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
const ARCHIVE_DIR = path.join(REPO_ROOT, "archive", "calls")
const STATE_PATH = path.join(REPO_ROOT, "capture", ".state.json")
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1)

const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  "Library/Application Support/CallHistoryDB/CallHistory.storedata"
)

function main() {
  const options = parseArgs(process.argv.slice(2))

  if (!fs.existsSync(options.dbPath)) {
    console.error(`[calls] Database not found: ${options.dbPath}`)
    console.error("[calls] Full Disk Access is required in System Settings > Privacy.")
    process.exit(1)
  }

  const state = readState()
  const lastId = state.calls?.lastCallId ?? 0

  const calls = readCalls(options.dbPath, lastId, options.limit)
  console.log(`[calls] Found ${calls.length} new calls since id=${lastId}`)

  if (calls.length === 0) return

  const byDate = groupByDate(calls)
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true })

  let written = 0
  for (const [dateStr, records] of Object.entries(byDate)) {
    const filePath = path.join(ARCHIVE_DIR, `${dateStr}.json`)
    const existing: ArchiveRecord[] = fs.existsSync(filePath)
      ? (JSON.parse(fs.readFileSync(filePath, "utf8")) as ArchiveRecord[])
      : []

    const existingIds = new Set(existing.map(r => r.id))
    const newRecords = records.filter(r => !existingIds.has(r.id))
    if (newRecords.length > 0) {
      fs.writeFileSync(filePath, JSON.stringify([...existing, ...newRecords], null, 2))
      written += newRecords.length
    }
  }

  const maxId = Math.max(...calls.map(c => c.id))
  state.calls = { lastCallId: maxId, updatedAt: new Date().toISOString() }
  writeState(state)

  console.log(`[calls] Archived ${written} calls, watermark=${maxId}`)
}

function readCalls(dbPath: string, afterId: number, limit: number): ArchiveRecord[] {
  let sqlite: BetterSqliteDatabase | null = null
  try {
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
    sqlite.pragma("query_only = ON")

    const rows = sqlite
      .prepare<unknown[], CallRow>(`
        SELECT
          Z_PK              AS id,
          ZADDRESS          AS address,
          ZDURATION         AS duration,
          ZDATE             AS appleDate,
          ZORIGINATED       AS originated,
          ZANSWERED         AS answered,
          ZSERVICE_PROVIDER AS serviceProvider,
          ZNAME             AS displayName
        FROM ZCALLRECORD
        WHERE Z_PK > ?
        ORDER BY Z_PK ASC
        LIMIT ?
      `)
      .all(afterId, limit)

    return rows
      .map(row => {
        const ts = appleDateToISO(row.appleDate)
        if (!ts) return null
        return {
          id: row.id,
          address: row.address ?? "",
          displayName: row.displayName ?? "",
          timestamp: ts,
          durationSeconds: row.duration ?? 0,
          originated: Boolean(row.originated),
          answered: Boolean(row.answered),
          serviceProvider: row.serviceProvider ?? "com.apple.phone",
        }
      })
      .filter((r): r is ArchiveRecord => r !== null)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not read Call History database at ${dbPath}: ${msg}\n` +
        "Grant Full Disk Access to your terminal in System Settings > Privacy."
    )
  } finally {
    sqlite?.close()
  }
}

function appleDateToISO(value: unknown): string | null {
  const raw = typeof value === "number" ? value : null
  if (!raw) return null
  // CallHistory uses seconds since Apple epoch (not nanoseconds)
  const ms = APPLE_EPOCH_MS + raw * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function groupByDate(records: ArchiveRecord[]): Record<string, ArchiveRecord[]> {
  const groups: Record<string, ArchiveRecord[]> = {}
  for (const record of records) {
    const dateStr = record.timestamp.slice(0, 10)
    ;(groups[dateStr] ??= []).push(record)
  }
  return groups
}

function readState(): CaptureState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as CaptureState
  } catch {
    return {}
  }
}

function writeState(state: CaptureState) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
}

type Options = { dbPath: string; limit: number }

function parseArgs(args: string[]): Options {
  const options: Options = {
    dbPath: process.env.CALLS_DB_PATH ?? DEFAULT_DB_PATH,
    limit: Number(process.env.CALLS_CAPTURE_LIMIT ?? 500),
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]
    if (arg === "--db" && next) { options.dbPath = next; i++ }
    else if (arg === "--limit" && next) { options.limit = Number(next); i++ }
  }
  return options
}

function loadEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "apps/persons/.env"),
    path.join(process.cwd(), "apps/persons/.env.local"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) dotenv.config({ path: candidate, quiet: true })
  }
}

main()
