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

type WhatsAppMessage = {
  id: number
  text: string | null
  timestamp: string
  isFromMe: number
  fromJid: string | null
  chatJid: string | null
  partnerName: string | null
}

type ArchiveRecord = {
  id: number
  text: string
  timestamp: string
  isFromMe: boolean
  fromJid: string
  chatJid: string
  partnerName: string
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
const ARCHIVE_DIR = path.join(REPO_ROOT, "archive", "whatsapp")
const STATE_PATH = path.join(REPO_ROOT, "capture", ".state.json")
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1)

const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"
)

function main() {
  const options = parseArgs(process.argv.slice(2))

  if (!fs.existsSync(options.dbPath)) {
    console.error(`[whatsapp] Database not found: ${options.dbPath}`)
    console.error("[whatsapp] WhatsApp must be installed and have sent/received at least one message.")
    process.exit(1)
  }

  const state = readState()
  const lastId = state.whatsapp?.lastMessageId ?? 0

  const messages = readMessages(options.dbPath, lastId, options.limit)
  console.log(`[whatsapp] Found ${messages.length} new messages since id=${lastId}`)

  if (messages.length === 0) return

  const byDate = groupByDate(messages)
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

  const maxId = Math.max(...messages.map(m => m.id))
  state.whatsapp = { lastMessageId: maxId, updatedAt: new Date().toISOString() }
  writeState(state)

  console.log(`[whatsapp] Archived ${written} messages, watermark=${maxId}`)
}

function readMessages(dbPath: string, afterId: number, limit: number): ArchiveRecord[] {
  let sqlite: BetterSqliteDatabase | null = null
  try {
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
    sqlite.pragma("query_only = ON")

    const rows = sqlite
      .prepare<unknown[], WhatsAppMessage>(`
        SELECT
          m.Z_PK            AS id,
          m.ZTEXT           AS text,
          m.ZMESSAGEDATE    AS timestamp,
          m.ZISFROMME       AS isFromMe,
          m.ZFROMJID        AS fromJid,
          c.ZCONTACTJID     AS chatJid,
          c.ZPARTNERNAME    AS partnerName
        FROM ZWAMESSAGE m
        LEFT JOIN ZWACHATSESSION c ON c.Z_PK = m.ZCHATSESSION
        WHERE m.Z_PK > ?
          AND m.ZTEXT IS NOT NULL
          AND length(trim(m.ZTEXT)) > 0
        ORDER BY m.Z_PK ASC
        LIMIT ?
      `)
      .all(afterId, limit)

    return rows
      .map(row => {
        const ts = appleDateToISO(row.timestamp)
        if (!ts) return null
        return {
          id: row.id,
          text: row.text ?? "",
          timestamp: ts,
          isFromMe: Boolean(row.isFromMe),
          fromJid: row.fromJid ?? row.chatJid ?? "",
          chatJid: row.chatJid ?? "",
          partnerName: row.partnerName ?? "",
        }
      })
      .filter((r): r is ArchiveRecord => r !== null)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not read WhatsApp database at ${dbPath}: ${msg}\n` +
        "Grant Full Disk Access to your terminal in System Settings > Privacy."
    )
  } finally {
    sqlite?.close()
  }
}

function appleDateToISO(value: unknown): string | null {
  const raw = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : null
  if (!raw) return null
  let ms: number
  if (raw > 1_000_000_000_000) ms = APPLE_EPOCH_MS + raw / 1_000_000
  else if (raw > 1_000_000_000) ms = APPLE_EPOCH_MS + raw * 1_000
  else ms = APPLE_EPOCH_MS + raw * 1_000
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
    dbPath: process.env.WHATSAPP_DB_PATH ?? DEFAULT_DB_PATH,
    limit: Number(process.env.WHATSAPP_CAPTURE_LIMIT ?? 500),
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
