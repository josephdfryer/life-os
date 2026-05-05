#!/usr/bin/env tsx

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import type { PrismaClient } from "@life-os/db"
import { assignColor } from "../apps/persons/lib/colors"

type BetterSqliteDatabase = {
  pragma(sql: string): unknown
  prepare<TParams extends unknown[] = unknown[], TResult = unknown>(sql: string): {
    all(...params: TParams): TResult[]
    get(...params: TParams): TResult | undefined
  }
  close(): void
}

type MessageRow = {
  messageId: number
  guid: string | null
  text: string | null
  attributedBody: Buffer | null
  appleDate: number | bigint | null
  isFromMe: number | null
  handleId: string | null
  uncanonicalizedId: string | null
  chatIdentifier: string | null
  chatDisplayName: string | null
  chatServiceName: string | null
  service: string | null
}

type State = {
  lastMessageRowId: number
  updatedAt: string
}

type Options = {
  chatDbPath: string
  statePath: string
  intervalMs: number
  limit: number
  watch: boolean
  dryRun: boolean
  initWatermark: boolean
  createMissing: boolean
  since: Date | null
}

type ExistingPerson = {
  id: string
  first: string
  last: string
  emails: string
  phones: string
}

type RuleCondition = {
  field: string
  operator: "equals" | "not_equals" | "contains" | "in" | "exists" | "not_exists"
  value?: unknown
}

type RuleAction = {
  type: string
  field?: string
  value?: unknown
}

const require = createRequire(import.meta.url)
const Database = require("better-sqlite3") as new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean }
) => BetterSqliteDatabase
const dotenv = require("dotenv") as { config(options: { path: string; quiet?: boolean }): void }

loadEnv()

let db: PrismaClient

const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1)
const SOURCE_PREFIX = "imessage:"
const DAY_TIME_ZONE = process.env.IMESSAGE_SYNC_DAY_TIME_ZONE ?? "America/Los_Angeles"

async function main() {
  db = (await import("@life-os/db")).db
  const options = parseArgs(process.argv.slice(2))

  if (options.initWatermark) {
    const maxMessageId = readMaxMessageId(options.chatDbPath)
    writeState(options.statePath, { lastMessageRowId: maxMessageId, updatedAt: new Date().toISOString() })
    console.log(`Initialized iMessage sync watermark at message ROWID ${maxMessageId}`)
    return
  }

  let shuttingDown = false
  process.on("SIGINT", () => { shuttingDown = true })
  process.on("SIGTERM", () => { shuttingDown = true })

  do {
    const result = await syncOnce(options)
    console.log(
      `iMessage sync: scanned=${result.scanned} createdPersons=${result.createdPersons} updatedPersons=${result.updatedPersons} createdInteractions=${result.createdInteractions} updatedInteractions=${result.updatedInteractions} stagedInteractions=${result.stagedInteractions} skippedExisting=${result.skippedExisting} watermark=${result.watermark}`
    )

    if (!options.watch || shuttingDown) break
    await sleep(options.intervalMs)
  } while (!shuttingDown)

  await disconnectDb()
}

async function syncOnce(options: Options) {
  const state = readState(options.statePath)
  const messages = readMessages(options.chatDbPath, state.lastMessageRowId, options.limit, options.since)

  let createdPersons = 0
  let updatedPersons = 0
  let createdInteractions = 0
  let updatedInteractions = 0
  let stagedInteractions = 0
  let skippedExisting = 0
  let watermark = state.lastMessageRowId
  const people = await loadPeopleIndex({ includeAutoCreated: options.createMissing })

  for (const message of messages) {
    watermark = Math.max(watermark, message.messageId)

    const identifier = normalizeIdentifier(message.handleId ?? message.uncanonicalizedId ?? message.chatIdentifier)
    if (!identifier) continue

    const body = extractMessageText(message)
    if (!body) continue

    const contact = contactFromMessage(message, identifier)
    const existing = findPerson(people, contact)
    const sourceId = `${SOURCE_PREFIX}${message.messageId}`

    if (options.dryRun) {
      console.log(`[dry-run] ${sourceId} ${contact.displayName} ${contact.direction}: ${snippet(body)}`)
      continue
    }

    if (await hasImportedMessage(sourceId, String(message.messageId))) {
      skippedExisting++
      continue
    }

    if (!existing && !options.createMissing) {
      await stageInboxRecord({
        message,
        contact,
        body,
        sourceId: String(message.messageId),
      })
      stagedInteractions++
      continue
    }

    const personResult = existing
      ? await updatePersonContact(existing, contact)
      : await createPerson(contact, people.personCount)

    if (!existing) createdPersons++
    if (existing && personResult.updated) updatedPersons++
    people.personCount += existing ? 0 : 1
    people.byId.set(personResult.person.id, personResult.person)
    indexPerson(people, personResult.person)

    const interactionResult = await upsertDailyMessageInteraction({
      personId: personResult.person.id,
      timestamp: appleDateToDate(message.appleDate),
      direction: contact.direction,
      summary: snippet(body),
      sourceId,
      service: message.service ?? message.chatServiceName ?? "iMessage",
    })
    if (interactionResult === "created") createdInteractions++
    if (interactionResult === "updated") updatedInteractions++
  }

  if (!options.dryRun && watermark > state.lastMessageRowId) {
    writeState(options.statePath, { lastMessageRowId: watermark, updatedAt: new Date().toISOString() })
  }

  return { scanned: messages.length, createdPersons, updatedPersons, createdInteractions, updatedInteractions, stagedInteractions, skippedExisting, watermark }
}

function readMessages(chatDbPath: string, afterRowId: number, limit: number, since: Date | null): MessageRow[] {
  const sqlite = openMessagesDb(chatDbPath)
  try {
    sqlite.pragma("query_only = ON")
    const sinceClause = since ? "AND message.date >= ?" : ""
    const params = since
      ? [afterRowId, dateToAppleNanoseconds(since), limit]
      : [afterRowId, limit]
    return sqlite.prepare<unknown[], MessageRow>(`
      SELECT
        message.ROWID AS messageId,
        message.guid AS guid,
        message.text AS text,
        message.attributedBody AS attributedBody,
        message.date AS appleDate,
        message.is_from_me AS isFromMe,
        handle.id AS handleId,
        handle.uncanonicalized_id AS uncanonicalizedId,
        chat.chat_identifier AS chatIdentifier,
        chat.display_name AS chatDisplayName,
        chat.service_name AS chatServiceName,
        message.service AS service
      FROM message
      LEFT JOIN handle ON handle.ROWID = message.handle_id
      LEFT JOIN chat_message_join ON chat_message_join.message_id = message.ROWID
      LEFT JOIN chat ON chat.ROWID = chat_message_join.chat_id
      WHERE message.ROWID > ?
      ${sinceClause}
      ORDER BY message.ROWID ASC
      LIMIT ?
    `).all(...params)
  } finally {
    sqlite.close()
  }
}

function readMaxMessageId(chatDbPath: string): number {
  const sqlite = openMessagesDb(chatDbPath)
  try {
    const row = sqlite.prepare<[], { maxMessageId: number | null }>("SELECT MAX(ROWID) AS maxMessageId FROM message").get()
    return row?.maxMessageId ?? 0
  } finally {
    sqlite.close()
  }
}

function openMessagesDb(chatDbPath: string): BetterSqliteDatabase {
  try {
    return new Database(chatDbPath, { readonly: true, fileMustExist: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not open iMessage database at ${chatDbPath}: ${message}. ` +
      "On macOS, grant Full Disk Access to the terminal/app running this script."
    )
  }
}

async function loadPeopleIndex(options: { includeAutoCreated: boolean }) {
  const persons = await db.person.findMany({
    select: { id: true, first: true, last: true, emails: true, phones: true },
    where: options.includeAutoCreated ? undefined : { NOT: { tags: { contains: "imessage" } } },
  })
  const people = {
    byId: new Map<string, ExistingPerson>(),
    byEmail: new Map<string, ExistingPerson>(),
    byPhone: new Map<string, ExistingPerson>(),
    personCount: persons.length,
  }
  for (const person of persons) {
    people.byId.set(person.id, person)
    indexPerson(people, person)
  }
  return people
}

function indexPerson(
  people: { byEmail: Map<string, ExistingPerson>; byPhone: Map<string, ExistingPerson> },
  person: ExistingPerson
) {
  for (const email of parseJsonArray(person.emails)) {
    const key = normalizeEmail(email)
    if (key) people.byEmail.set(key, person)
  }
  for (const phone of parseJsonArray(person.phones)) {
    const key = normalizePhone(phone)
    if (key) people.byPhone.set(key, person)
  }
}

function findPerson(
  people: { byEmail: Map<string, ExistingPerson>; byPhone: Map<string, ExistingPerson> },
  contact: ReturnType<typeof contactFromMessage>
) {
  if (contact.email) {
    const person = people.byEmail.get(normalizeEmail(contact.email))
    if (person) return person
  }
  if (contact.phone) {
    const person = people.byPhone.get(normalizePhone(contact.phone))
    if (person) return person
  }
  return null
}

async function createPerson(contact: ReturnType<typeof contactFromMessage>, index: number) {
  const { first, last } = splitName(contact.displayName)
  const { color, colorSoft } = assignColor(index)
  const person = await db.person.create({
    data: {
      first,
      last,
      emails: JSON.stringify(contact.email ? [contact.email] : []),
      phones: JSON.stringify(contact.phone ? [contact.phone] : []),
      closeness: 2,
      tags: JSON.stringify(["imessage"]),
      values: JSON.stringify([]),
      notes: "Created by iMessage sync.",
      color,
      colorSoft,
    },
    select: { id: true, first: true, last: true, emails: true, phones: true },
  })
  return { person, updated: false }
}

async function updatePersonContact(existing: ExistingPerson, contact: ReturnType<typeof contactFromMessage>) {
  const emails = parseJsonArray(existing.emails)
  const phones = parseJsonArray(existing.phones)
  let updated = false

  if (contact.email && !emails.some(email => normalizeEmail(email) === normalizeEmail(contact.email))) {
    emails.push(contact.email)
    updated = true
  }
  if (contact.phone && !phones.some(phone => normalizePhone(phone) === normalizePhone(contact.phone))) {
    phones.push(contact.phone)
    updated = true
  }

  if (!updated) return { person: existing, updated }

  const person = await db.person.update({
    where: { id: existing.id },
    data: { emails: JSON.stringify(emails), phones: JSON.stringify(phones) },
    select: { id: true, first: true, last: true, emails: true, phones: true },
  })
  return { person, updated }
}

async function upsertDailyMessageInteraction(input: {
  personId: string
  timestamp: Date
  direction: string
  summary: string
  sourceId: string
  service: string
}): Promise<"created" | "updated" | "skipped"> {
  const sourceMarker = normalizeSourceMarker(input.sourceId)
  const dayMarker = `imessage-day:${dayKey(input.timestamp)}`

  const duplicate = await findInteractionWithSource(sourceMarker, input.personId)
  if (duplicate) return "skipped"

  const existing = await db.interaction.findFirst({
    where: {
      personId: input.personId,
      type: "message",
      notes: { contains: dayMarker },
    },
    select: { id: true, eventId: true, summary: true, notes: true, direction: true },
    orderBy: { timestamp: "asc" },
  })

  const line = messageLine(input.timestamp, input.direction, input.summary)
  if (existing) {
    await db.interaction.update({
      where: { id: existing.id },
      data: {
        summary: appendLine(existing.summary, line),
        notes: appendLine(existing.notes, sourceMarker),
        direction: existing.direction === input.direction ? existing.direction : "mixed",
      },
    })
    return "updated"
  }

  const event = await db.event.create({
    data: {
      name: `iMessage ${dayKey(input.timestamp)}`,
      type: "message",
      timestamp: input.timestamp,
      metadata: JSON.stringify({ source: "imessage", day: dayKey(input.timestamp), service: input.service }),
    },
  })

  await db.interaction.create({
    data: {
      personId: input.personId,
      eventId: event.id,
      type: "message",
      timestamp: input.timestamp,
      summary: line,
      notes: `${dayMarker}\n${sourceMarker}`,
      direction: input.direction,
    },
  })
  return "created"
}

async function hasImportedMessage(sourceMarker: string, stagedSourceId: string) {
  const imported = await findInteractionWithSource(sourceMarker)
  if (imported) return true

  const staged = await db.stagedInteraction.findUnique({
    where: {
      source_sourceId: {
        source: "imessage",
        sourceId: stagedSourceId,
      },
    },
    select: { status: true },
  })

  return Boolean(staged)
}

async function findInteractionWithSource(sourceMarker: string, personId?: string) {
  const marker = normalizeSourceMarker(sourceMarker)
  const candidates = await db.interaction.findMany({
    where: {
      ...(personId ? { personId } : {}),
      notes: { contains: marker },
    },
    select: { id: true, notes: true },
    take: 20,
  })
  return candidates.find(candidate => sourceMarkers(candidate.notes).includes(marker)) ?? null
}

function sourceMarkers(notes: string | null | undefined) {
  return (notes ?? "").split(/\s+/).filter(part => part.startsWith(SOURCE_PREFIX))
}

async function stageInboxRecord(input: {
  message: MessageRow
  contact: ReturnType<typeof contactFromMessage>
  body: string
  sourceId: string
}) {
  const timestamp = appleDateToDate(input.message.appleDate)
  const metadata = {
    guid: input.message.guid,
    chatIdentifier: input.message.chatIdentifier,
    chatDisplayName: input.message.chatDisplayName,
    service: input.message.service ?? input.message.chatServiceName ?? "iMessage",
  }
  const staged = await db.stagedInteraction.upsert({
    where: {
      source_sourceId: {
        source: "imessage",
        sourceId: input.sourceId,
      },
    },
    update: {
      contactName: input.contact.displayName,
      contactEmail: input.contact.email,
      contactPhone: input.contact.phone,
      timestamp,
      summary: snippet(input.body),
      body: input.body,
      direction: input.contact.direction,
      metadata: JSON.stringify(metadata),
    },
    create: {
      source: "imessage",
      sourceId: input.sourceId,
      itemType: "interaction",
      status: "pending",
      contactName: input.contact.displayName,
      contactEmail: input.contact.email,
      contactPhone: input.contact.phone,
      type: "message",
      timestamp,
      summary: snippet(input.body),
      body: input.body,
      direction: input.contact.direction,
      metadata: JSON.stringify(metadata),
    },
    select: { id: true },
  })

  await runRulesForInboxRecord({
    stagedInteractionId: staged.id,
    source: "imessage",
    sourceId: input.sourceId,
    itemType: "interaction",
    type: "message",
    timestamp,
    summary: snippet(input.body),
    body: input.body,
    direction: input.contact.direction,
    contactName: input.contact.displayName,
    contactEmail: input.contact.email,
    contactPhone: input.contact.phone,
    metadata,
  })
}

async function runRulesForInboxRecord(payload: Record<string, unknown> & { stagedInteractionId: string }) {
  const rules = await db.rule.findMany({
    where: { trigger: "ingest.message", status: "active" },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  })

  for (const rule of rules) {
    const conditions = parseStoredArray(rule.conditions) as RuleCondition[]
    const actions = parseStoredArray(rule.actions) as RuleAction[]
    const result = evaluateRule(conditions, actions, payload)
    const applied = result.matched && ["auto", "block"].includes(rule.mode)
      ? await applyStagedRuleActions(payload.stagedInteractionId, actions)
      : []
    await db.ruleRun.create({
      data: {
        ruleId: rule.id,
        trigger: rule.trigger,
        targetType: "stagedInteraction",
        targetId: payload.stagedInteractionId,
        matched: result.matched,
        mode: rule.mode,
        status: runStatus(rule.mode, result.matched, applied.length),
        input: JSON.stringify(payload),
        actionsPlanned: JSON.stringify(result.matched ? actions : []),
        actionsApplied: JSON.stringify(applied),
        message: result.message,
      },
    })
    if (result.matched && rule.stopProcessing) break
  }
}

function evaluateRule(conditions: RuleCondition[], actions: RuleAction[], payload: Record<string, unknown>) {
  const failures: string[] = []
  for (const condition of conditions) {
    if (!matchesCondition(condition, payload)) {
      failures.push(`${condition.field} ${condition.operator}`)
    }
  }
  const matched = failures.length === 0
  return {
    matched,
    actionsPlanned: matched ? actions : [],
    message: matched ? "Rule matched" : `No match: ${failures.join(", ")}`,
  }
}

function matchesCondition(condition: RuleCondition, payload: Record<string, unknown>) {
  const actual = getPath(payload, condition.field)
  switch (condition.operator) {
    case "equals":
      return normalize(actual) === normalize(condition.value)
    case "not_equals":
      return normalize(actual) !== normalize(condition.value)
    case "contains":
      return normalize(actual).includes(normalize(condition.value))
    case "in":
      return Array.isArray(condition.value) && condition.value.map(normalize).includes(normalize(actual))
    case "exists":
      return actual !== undefined && actual !== null && actual !== ""
    case "not_exists":
      return actual === undefined || actual === null || actual === ""
    default:
      return false
  }
}

async function applyStagedRuleActions(stagedInteractionId: string, actions: RuleAction[]) {
  const patch: Record<string, unknown> = {}
  const applied: RuleAction[] = []
  for (const action of actions) {
    const type = normalize(action.type)
    if (type === "block") {
      patch.status = "blocked"
      applied.push({ type: action.type, field: "status", value: "blocked" })
      continue
    }
    if (!["set", "set_field", "assign"].includes(type) || !action.field) continue
    if (!isStagedInteractionField(action.field)) continue
    patch[action.field] = action.value
    applied.push(action)
  }

  if (Object.keys(patch).length) {
    await db.stagedInteraction.update({
      where: { id: stagedInteractionId },
      data: patch,
    })
  }

  return applied
}

function runStatus(mode: string, matched: boolean, appliedCount: number) {
  if (!matched) return "skipped"
  if (mode === "dry_run") return "dry_run"
  if (mode === "suggest") return "suggested"
  if (mode === "block") return "blocked"
  if (mode === "auto") return appliedCount > 0 ? "applied" : "planned"
  return "processed"
}

function isStagedInteractionField(field: string) {
  return [
    "candidatePersonId",
    "confidence",
    "matchReason",
    "status",
    "summary",
    "direction",
    "contactName",
    "contactEmail",
    "contactPhone",
  ].includes(field)
}

function parseStoredArray(value: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getPath(payload: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, payload)
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function contactFromMessage(message: MessageRow, identifier: string) {
  const email = identifier.includes("@") ? identifier : null
  const phone = email ? null : identifier
  const chatName = cleanName(message.chatDisplayName)
  const displayName = chatName && !looksLikeIdentifier(chatName) ? chatName : displayNameFromIdentifier(identifier)
  return {
    displayName,
    email,
    phone,
    direction: message.isFromMe ? "outbound" : "inbound",
  }
}

function extractMessageText(message: MessageRow): string | null {
  const text = message.text?.trim()
  if (text) return text

  if (!message.attributedBody) return null
  const decoded = decodeAttributedBody(message.attributedBody).trim()
  return decoded || null
}

function decodeAttributedBody(body: Buffer): string {
  const utf8 = body.toString("utf8")
  const nsStringMatch = utf8.match(/NSString[\s\S]{0,80}?[+][^\x00-\x08\x0e-\x1f]{1,200}/)
  if (nsStringMatch) {
    const decoded = cleanDecodedText(nsStringMatch[0].replace(/^.*?\+/, ""))
    if (isUsefulDecodedText(decoded)) return decoded
  }

  const printableRuns = utf8
    .split(/[^\x20-\x7e\n\r\t]+/)
    .map(part => part.trim())
    .filter(part => part.length > 0)

  const archivedString = extractArchivedString(printableRuns)
  if (archivedString) return archivedString

  const link = findLast(printableRuns, part => /^https?:\/\//.test(part) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(part))
  if (link) return cleanDecodedText(link)

  const fallback = findLast(printableRuns, part => isUsefulDecodedText(cleanDecodedText(part)))
  return cleanDecodedText(fallback ?? "")
}

function cleanDecodedText(value: string): string {
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .replace(/\uFFFD+/g, "")
    .replace(/\s+”/g, "”")
    .trim()
    .replace(/^\+/, "")
    .trim()

  return stripArchiveLengthPrefix(normalized)
}

function extractArchivedString(runs: string[]): string | null {
  const stop = /^(iI|NSDictionary|NSMutableData|NSData|NSNumber|NSValue|NSObject|NSAttributedString|NSMutableAttributedString|NSMutableString|__kIM)/
  const candidates: string[] = []

  for (let i = 0; i < runs.length; i++) {
    if (runs[i] !== "NSString" && runs[i] !== "NSMutableString") continue

    const parts: string[] = []
    for (let j = i + 1; j < runs.length; j++) {
      const part = runs[j]
      if (part === "+") continue
      if (stop.test(part)) break
      if (part.length === 1 && !parts.length) continue
      parts.push(part)
    }

    const decoded = cleanDecodedText(parts.join(" "))
    if (isUsefulDecodedText(decoded)) candidates.push(decoded)
  }

  return candidates.sort((a, b) => b.length - a.length)[0] ?? null
}

function isUsefulDecodedText(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 2) return false
  if (/^(streamtyped|NSString|NSDictionary|NSColor|NSNumber|NSObject|NSValue|NSURL|__kIM)/.test(trimmed)) return false
  return /[\p{L}\p{N}]/u.test(trimmed)
}

function stripArchiveLengthPrefix(value: string): string {
  let clean = value.trim()
  for (let i = 0; i < 3; i++) {
    const before = clean
    clean = clean.replace(/^SString\s+/, "").trim()
    if (/^[^A-Za-z0-9]\s*[A-Za-z0-9]/.test(clean)) clean = clean.replace(/^[^A-Za-z0-9]\s*/, "").trim()
    if (/^[A-Za-z][A-Z]/.test(clean)) clean = clean.slice(1).trim()
    if (clean === before || clean.length < 2) break
  }
  return clean
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return items[i]
  }
  return undefined
}

function appleDateToDate(value: MessageRow["appleDate"]): Date {
  const raw = typeof value === "bigint" ? Number(value) : value ?? 0
  if (!raw) return new Date()
  if (raw > 100_000_000_000_000) return new Date(APPLE_EPOCH_MS + raw / 1_000_000)
  if (raw > 100_000_000_000) return new Date(APPLE_EPOCH_MS + raw / 1_000)
  return new Date(APPLE_EPOCH_MS + raw * 1000)
}

function dateToAppleNanoseconds(date: Date): string {
  return String(BigInt(date.getTime() - APPLE_EPOCH_MS) * 1_000_000n)
}

function parseSince(value: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --since date: ${value}`)
  return date
}

function dayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function messageLine(timestamp: Date, direction: string, summary: string) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: DAY_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp)
  return `[${time} ${direction}] ${summary}`
}

function normalizeSourceMarker(sourceId: string) {
  return sourceId.startsWith(SOURCE_PREFIX) ? sourceId : `${SOURCE_PREFIX}${sourceId}`
}

function appendLine(existing: string | null | undefined, next: string) {
  const clean = existing?.trim()
  if (!clean) return next
  if (clean.includes(next)) return clean
  return `${clean}\n${next}`
}

function readState(statePath: string): State {
  try {
    const raw = fs.readFileSync(statePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<State>
    return {
      lastMessageRowId: Number(parsed.lastMessageRowId ?? 0),
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return { lastMessageRowId: Number(process.env.IMESSAGE_SYNC_START_ROWID ?? 0), updatedAt: new Date(0).toISOString() }
  }
}

function writeState(statePath: string, state: State) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    chatDbPath: process.env.IMESSAGE_DB_PATH ?? path.join(os.homedir(), "Library/Messages/chat.db"),
    statePath: process.env.IMESSAGE_SYNC_STATE_PATH ?? path.join(os.homedir(), ".life-os/imessage-sync-state.json"),
    intervalMs: Number(process.env.IMESSAGE_SYNC_INTERVAL_MS ?? 15_000),
    limit: Number(process.env.IMESSAGE_SYNC_LIMIT ?? 250),
    watch: false,
    dryRun: false,
    initWatermark: false,
    createMissing: false,
    since: null,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]
    if (arg === "--watch") options.watch = true
    else if (arg === "--once") options.watch = false
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--init-watermark") options.initWatermark = true
    else if (arg === "--create-missing") options.createMissing = true
    else if (arg === "--db" && next) options.chatDbPath = expandHome(next), i++
    else if (arg === "--state" && next) options.statePath = expandHome(next), i++
    else if (arg === "--interval-ms" && next) options.intervalMs = Number(next), i++
    else if (arg === "--limit" && next) options.limit = Number(next), i++
    else if (arg === "--since" && next) options.since = parseSince(next), i++
    else if (arg === "--days" && next) options.since = new Date(Date.now() - Number(next) * 24 * 60 * 60 * 1000), i++
    else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  options.chatDbPath = expandHome(options.chatDbPath)
  options.statePath = expandHome(options.statePath)
  return options
}

function printHelp() {
  console.log(`Usage: npm run imessage:sync -- [options]

Options:
  --once                 Process new messages once. This is the default.
  --watch                Poll chat.db continuously for launchd-style use.
  --init-watermark       Set the watermark to the current latest message and exit.
  --create-missing       Create new People for unmatched phone/email handles.
  --dry-run              Print planned work without writing to Persons.
  --db <path>            Path to chat.db. Defaults to ~/Library/Messages/chat.db.
  --state <path>         Watermark file. Defaults to ~/.life-os/imessage-sync-state.json.
  --interval-ms <ms>     Watch poll interval. Defaults to 15000.
  --limit <count>        Max messages per pass. Defaults to 250.
  --since <date>         Only process messages dated on/after this ISO date.
  --days <count>         Only process messages dated within the last N days.

launchd ProgramArguments example:
  /opt/homebrew/bin/npm run imessage:sync -- --watch --interval-ms 15000
`)
}

function loadEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "packages/db/.env"),
    path.join(process.cwd(), "apps/persons/.env"),
    path.join(process.cwd(), "apps/persons/.env.local"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) dotenv.config({ path: candidate, quiet: true })
  }
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function normalizeIdentifier(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === "chat") return null
  if (trimmed.includes("@")) return normalizeEmail(trimmed)
  return normalizePhone(trimmed) || trimmed
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizePhone(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 7) return trimmed
  return digits.length === 10 ? `+1${digits}` : `+${digits.replace(/^00/, "")}`
}

function displayNameFromIdentifier(identifier: string): string {
  if (identifier.includes("@")) return identifier.split("@")[0].replace(/[._-]+/g, " ")
  return identifier
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: "Unknown", last: "" }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

function cleanName(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function looksLikeIdentifier(value: string): boolean {
  return value.includes("@") || value.replace(/\D/g, "").length >= 7
}

function snippet(value: string, max = 240): string {
  const clean = value.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir()
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2))
  return value
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(async error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  await disconnectDb()
  process.exit(1)
})

async function disconnectDb() {
  if (db) await db.$disconnect()
}
