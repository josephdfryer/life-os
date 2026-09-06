#!/usr/bin/env tsx

import Anthropic from "@anthropic-ai/sdk"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import dotenv from "dotenv"
import JSZip from "jszip"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const LIFE_OS_ROOT = path.resolve(import.meta.dirname, "../..")
const TEAM_OS_ROOT = process.env.TEAM_OS_ROOT ?? "/Users/josephfryer/team-os"
const STATE_PATH = process.env.KRISP_SYNC_STATE_PATH ?? path.join(os.homedir(), ".life-os/krisp-team-os-state.json")
const DEFAULT_ICS_EXPORT_PATH = "/Users/josephfryer/Downloads/jfryer@sightmachine.com.ical.zip"
const MCP_URL = "https://mcp.krisp.ai/mcp"
const MODEL = process.env.KRISP_PROCESSING_MODEL ?? "claude-haiku-4-5-20251001"
const OVERLAP_MS = 24 * 60 * 60 * 1000
const DEFAULT_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000
const CUSTOMER_CONFIDENCE_THRESHOLD = 0.75
const MCP_FAST_TIMEOUT = { timeout: 15000, maxTotalTimeout: 30000 }
const MCP_DOCUMENT_TIMEOUT = { timeout: 30000, maxTotalTimeout: 60000 }

dotenv.config({ path: path.join(LIFE_OS_ROOT, "apps/persons/.env.production.local"), quiet: true })
dotenv.config({ path: path.join(LIFE_OS_ROOT, "apps/persons/.env.local"), quiet: true })
dotenv.config({ path: path.join(LIFE_OS_ROOT, "apps/persons/.env"), quiet: true })
dotenv.config({ path: path.join(LIFE_OS_ROOT, ".env"), quiet: true })

// This worker historically wrote to a local SQLite file, never the shared
// production workspace. Postgres has no file mode, so it now requires an
// explicit KRISP_DATABASE_URL and refuses to fall back to DATABASE_URL.
if (!process.env.KRISP_DATABASE_URL) {
  console.error("KRISP_DATABASE_URL is required (a dedicated Postgres database for Team OS records).")
  process.exit(1)
}
process.env.DATABASE_URL = process.env.KRISP_DATABASE_URL

type JsonRecord = Record<string, unknown>
type KrispMeeting = {
  meeting_id: string
  name: string
  date: string
  url?: string
  attendees?: unknown[]
  speakers?: unknown[]
}
type CalendarMatch = {
  eventId: string | null
  externalEventId: string
  name: string
  timestamp: Date
  attendees: Array<{ email?: string; displayName?: string }>
  score: number
}
type Customer = { slug: string; name: string; aliases: string[] }
type Segment = {
  destination: "customer" | "internal" | "review"
  customerSlug: string | null
  confidence: number
  substantive: boolean
  evidence: string[]
  title: string
  keyPoints: string[]
  decisions: string[]
  actionItems: string[]
  notes: string[]
}
type State = { lastCheckedAt: string | null; processedMeetingIds: string[] }
type Options = { dryRun: boolean; reprocess: boolean; backfillDays: number | null; limit: number; meetingId: string | null }
type LedgerRow = {
  key: string
  date: string
  time: string
  meeting: string
  attendees: string
  customer: string
  destination: string
  calendar: string
  krisp: string
  file: string
}
type IcsEvent = {
  source: string
  uid: string
  name: string
  timestamp: Date
  attendees: Array<{ email?: string; displayName?: string }>
}
let icsEventCache: Promise<IcsEvent[]> | null = null

async function main() {
  const options = parseOptions(process.argv.slice(2))
  assertSetup()
  if (process.argv.includes("--rebuild-ledger")) {
    rebuildMeetingLedger()
    return
  }
  const state = loadState()
  const knownIds = new Set(state.processedMeetingIds)
  const existingUrls = scanExistingKrispUrls()
  const customers = loadCustomers()
  const after = resolveAfter(state, options)
  const { client, transport } = await connectKrisp()

  try {
    const meetings = options.meetingId
      ? await searchMeetingsById(client, options.meetingId)
      : await searchMeetings(client, after, options.limit)
    const pending = meetings
      .filter(meeting => options.reprocess || !knownIds.has(meeting.meeting_id))
      .filter(meeting => options.reprocess || !meeting.url || !existingUrls.has(meeting.url))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))

    if (!pending.length) {
      console.log(`[krisp] No new meetings after ${after}`)
      if (!options.dryRun) saveState({ ...state, lastCheckedAt: new Date().toISOString() })
      return
    }

    console.log(`[krisp] Found ${pending.length} new meeting(s) after ${after}`)
    let hadFailures = false
    for (const meeting of pending) {
      try {
        await processMeeting(client, meeting, customers, options)
        if (!options.dryRun) knownIds.add(meeting.meeting_id)
      } catch (error) {
        hadFailures = true
        console.error(`[krisp] Failed ${meeting.meeting_id}: ${errorMessage(error)}`)
      }
    }

    if (!options.dryRun) {
      saveState({
        lastCheckedAt: hadFailures ? state.lastCheckedAt : new Date().toISOString(),
        processedMeetingIds: Array.from(knownIds).slice(-2000),
      })
    }
  } finally {
    await client.close().catch(() => undefined)
    await transport.close().catch(() => undefined)
    const { db } = await import("@life-os/db")
    await db.$disconnect().catch(() => undefined)
  }
}

async function processMeeting(client: Client, meeting: KrispMeeting, customers: Customer[], options: Options) {
  const transcript = await fetchTranscript(client, meeting.meeting_id)
  if (!transcript.trim()) throw new Error("Krisp returned an empty transcript")
  const calendarMatch = await matchCalendarEvent(meeting)
  const segments = normalizeSegments(await splitMeeting(meeting, transcript, calendarMatch, customers), meeting, customers, transcript)

  console.log(
    `[krisp] ${meeting.date} ${meeting.meeting_id}: calendar=${calendarMatch?.name ?? "unmatched"}; ` +
      `destinations=${segments.map(segment => segment.customerSlug ?? segment.destination).join(", ")}`,
  )
  if (options.dryRun) return

  archiveTranscript(meeting, transcript, calendarMatch)
  for (const segment of segments) {
    const target = writeSegment(meeting, segment, calendarMatch)
    if (target) appendLedgerRow(ledgerRowForSegment(meeting, segment, calendarMatch, target))
  }
  if (calendarMatch?.eventId) await attachTranscriptToEvent(calendarMatch.eventId, meeting, transcript)
}

async function connectKrisp() {
  const client = new Client({ name: "life-os-krisp-sync", version: "1.0.0" })
  const transport = new StdioClientTransport({
    command: path.join(LIFE_OS_ROOT, "node_modules/.bin/mcp-remote"),
    args: [MCP_URL, "--silent"],
    cwd: LIFE_OS_ROOT,
    stderr: "inherit",
  })
  await client.connect(transport)
  return { client, transport }
}

async function searchMeetings(client: Client, after: string, limit: number): Promise<KrispMeeting[]> {
  const meetings: KrispMeeting[] = []
  for (let offset = 0; meetings.length < limit; offset += 50) {
    const result = await client.callTool({
      name: "search_meetings",
      arguments: {
        after,
        limit: Math.min(50, limit - meetings.length),
        offset,
        isOwner: true,
        fields: ["name", "date", "url", "attendees", "speakers", "transcript"],
      },
    }, undefined, MCP_FAST_TIMEOUT)
    const structured = asRecord(result.structuredContent)
    const batch = Array.isArray(structured?.meetings) ? structured.meetings.filter(isMeeting) : []
    meetings.push(...batch)
    if (batch.length < 50) break
  }
  return meetings
}

async function searchMeetingsById(client: Client, meetingId: string): Promise<KrispMeeting[]> {
  const result = await client.callTool({
    name: "search_meetings",
    arguments: {
      id: meetingId.replaceAll("-", ""),
      fields: ["name", "date", "url", "attendees", "speakers", "transcript"],
    },
  }, undefined, MCP_FAST_TIMEOUT)
  const structured = asRecord(result.structuredContent)
  return Array.isArray(structured?.meetings) ? structured.meetings.filter(isMeeting) : []
}

async function fetchTranscript(client: Client, meetingId: string) {
  const result = await client.callTool({
    name: "get_multiple_documents",
    arguments: { ids: [meetingId.replaceAll("-", "")] },
  }, undefined, MCP_DOCUMENT_TIMEOUT)
  const structured = asRecord(result.structuredContent)
  const results = Array.isArray(structured?.results) ? structured.results : []
  const first = asRecord(results[0])
  return typeof first?.document === "string" ? stripRecordingDownload(first.document) : ""
}

async function matchCalendarEvent(meeting: KrispMeeting): Promise<CalendarMatch | null> {
  const meetingStart = new Date(meeting.date)
  if (Number.isNaN(meetingStart.getTime())) return null
  const meetingPeople = normalizePeople([...(meeting.attendees ?? []), ...(meeting.speakers ?? [])])
  const appleCandidates = fetchAppleCalendarCandidates(
    new Date(meetingStart.getTime() - 3 * 60 * 60 * 1000),
    new Date(meetingStart.getTime() + 3 * 60 * 60 * 1000),
  )
  const appleBest = bestCalendarCandidate(appleCandidates, meetingStart, meeting.name, meetingPeople)
  if (appleBest) return appleBest

  const icsBest = bestCalendarCandidate(
    await fetchIcsCalendarCandidates(
      new Date(meetingStart.getTime() - 3 * 60 * 60 * 1000),
      new Date(meetingStart.getTime() + 3 * 60 * 60 * 1000),
    ),
    meetingStart,
    meeting.name,
    meetingPeople,
  )
  if (icsBest) return icsBest

  const { db } = await import("@life-os/db")
  const { decryptNullable } = await import("@life-os/db/crypto")
  const connection = await db.calendarConnection.findFirst({
    where: { provider: "google", status: "active" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      workspaceId: true,
      calendarId: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      expiresAt: true,
    },
  })
  if (!connection) return null
  const accessToken = await googleAccessToken({
    accessToken: decryptNullable(connection.accessTokenEncrypted),
    refreshToken: decryptNullable(connection.refreshTokenEncrypted),
    expiresAt: connection.expiresAt,
  })
  const candidates = await fetchGoogleCalendarCandidates(
    accessToken,
    connection.calendarId,
    new Date(meetingStart.getTime() - 3 * 60 * 60 * 1000),
    new Date(meetingStart.getTime() + 3 * 60 * 60 * 1000),
  )

  const best = bestCalendarCandidate(candidates, meetingStart, meeting.name, meetingPeople)
  if (!best || best.score < 35) return null
  const link = await db.calendarEventLink.findUnique({
    where: {
      workspaceId_provider_calendarId_externalEventId: {
        workspaceId: connection.workspaceId,
        provider: "google",
        calendarId: connection.calendarId,
        externalEventId: best.externalEventId,
      },
    },
    select: { eventId: true },
  })
  return { ...best, eventId: link?.eventId ?? null }
}

function fetchAppleCalendarCandidates(timeMin: Date, timeMax: Date): CalendarMatch[] {
  const calendarNames = (process.env.KRISP_APPLE_CALENDARS ?? "Joseph Fryer,Calendar")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
  const calendarList = calendarNames.map(value => `"${value.replaceAll('"', '\\"')}"`).join(", ")
  const makeDate = (name: string, value: Date) => `
set ${name} to current date
set year of ${name} to ${value.getFullYear()}
set month of ${name} to ${value.getMonth() + 1}
set day of ${name} to ${value.getDate()}
set hours of ${name} to ${value.getHours()}
set minutes of ${name} to ${value.getMinutes()}
set seconds of ${name} to ${value.getSeconds()}`
  const script = `${makeDate("windowStart", timeMin)}
${makeDate("windowEnd", timeMax)}
set outputText to ""
tell application "Calendar"
  repeat with calendarName in {${calendarList}}
    try
      set cal to calendar calendarName
      set matches to every event of cal whose start date is greater than or equal to windowStart and start date is less than or equal to windowEnd
      repeat with ev in matches
        set eventDate to start date of ev
        set attendeeText to ""
        try
          repeat with personRef in attendees of ev
            set attendeeText to attendeeText & (display name of personRef) & ";" & (email of personRef) & ","
          end repeat
        end try
        set outputText to outputText & (uid of ev) & tab & (summary of ev) & tab & (year of eventDate as integer) & tab & (month of eventDate as integer) & tab & (day of eventDate) & tab & (hours of eventDate) & tab & (minutes of eventDate) & tab & attendeeText & linefeed
      end repeat
    end try
  end repeat
end tell
return outputText`
  try {
    const output = execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 8000 })
    return output.trim().split("\n").flatMap(line => {
      const [externalEventId, name, year, month, day, hour, minute, attendeeText = ""] = line.split("\t")
      const timestamp = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
      if (!externalEventId || !name || Number.isNaN(timestamp.getTime())) return []
      const attendees = attendeeText.split(",").filter(Boolean).map(value => {
        const [displayName, email] = value.split(";")
        return { displayName, email }
      })
      return [{ eventId: null, externalEventId, name, timestamp, attendees, score: 0 }]
    })
  } catch (error) {
    console.warn(`[krisp] Apple Calendar lookup unavailable: ${errorMessage(error)}`)
    return []
  }
}

async function fetchIcsCalendarCandidates(timeMin: Date, timeMax: Date): Promise<CalendarMatch[]> {
  const events = await loadIcsEvents().catch(error => {
    console.warn(`[krisp] ICS calendar lookup unavailable: ${errorMessage(error)}`)
    return []
  })
  return events
    .filter(event => event.timestamp >= timeMin && event.timestamp <= timeMax)
    .map(event => ({
      eventId: null,
      externalEventId: `ics:${event.source}:${event.uid}`,
      name: event.name,
      timestamp: event.timestamp,
      attendees: event.attendees,
      score: 0,
    }))
}

async function loadIcsEvents(): Promise<IcsEvent[]> {
  if (!icsEventCache) icsEventCache = readIcsEvents()
  return icsEventCache
}

async function readIcsEvents(): Promise<IcsEvent[]> {
  const exportPath = process.env.KRISP_ICS_EXPORT_PATH ?? DEFAULT_ICS_EXPORT_PATH
  if (!fs.existsSync(exportPath)) return []

  if (exportPath.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(fs.readFileSync(exportPath))
    const files = Object.values(zip.files).filter(file => !file.dir && file.name.toLowerCase().endsWith(".ics"))
    const calendars = await Promise.all(files.map(async file => ({
      source: path.basename(file.name),
      text: await file.async("text"),
    })))
    return calendars.flatMap(calendar => parseIcsEvents(calendar.text, calendar.source))
  }

  return parseIcsEvents(fs.readFileSync(exportPath, "utf8"), path.basename(exportPath))
}

function parseIcsEvents(text: string, source: string): IcsEvent[] {
  const lines = unfoldIcsLines(text)
  const events: IcsEvent[] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = []
    } else if (line === "END:VEVENT" && current) {
      const event = parseIcsEvent(current, source)
      if (event) events.push(event)
      current = null
    } else if (current) {
      current.push(line)
    }
  }
  return events
}

function unfoldIcsLines(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const lines: string[] = []
  for (const line of normalized) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function parseIcsEvent(lines: string[], source: string): IcsEvent | null {
  const fields = lines.map(parseIcsProperty).filter((field): field is IcsProperty => Boolean(field))
  const uid = fields.find(field => field.name === "UID")?.value ?? cryptoRandomId()
  const summary = fields.find(field => field.name === "SUMMARY")?.value
  const startField = fields.find(field => field.name === "DTSTART")
  if (!summary || !startField) return null
  const timestamp = parseIcsDate(startField)
  if (!timestamp) return null
  const attendees = fields
    .filter(field => field.name === "ATTENDEE" || field.name === "ORGANIZER")
    .map(icsPerson)
    .filter(person => person.email || person.displayName)
  return {
    source,
    uid,
    name: unescapeIcsText(summary),
    timestamp,
    attendees,
  }
}

type IcsProperty = { name: string; params: Record<string, string>; value: string }

function parseIcsProperty(line: string): IcsProperty | null {
  const separator = line.indexOf(":")
  if (separator < 0) return null
  const head = line.slice(0, separator)
  const value = line.slice(separator + 1)
  const [name = "", ...paramParts] = head.split(";")
  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const equals = part.indexOf("=")
    if (equals < 0) continue
    params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, "")
  }
  return { name: name.toUpperCase(), params, value }
}

function parseIcsDate(field: IcsProperty): Date | null {
  const value = field.value.trim()
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) return zonedDateTimeToDate(dateOnly[1], dateOnly[2], dateOnly[3], "00", "00", "00", "America/Los_Angeles")

  const dateTime = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/)
  if (!dateTime) return null
  const [, year, month, day, hour, minute, second = "00", zulu] = dateTime
  if (zulu) return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)))
  return zonedDateTimeToDate(year, month, day, hour, minute, second, field.params.TZID ?? "America/Los_Angeles")
}

function zonedDateTimeToDate(year: string, month: string, day: string, hour: string, minute: string, second: string, timeZone: string) {
  const targetUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  let timestamp = targetUtc
  for (let index = 0; index < 3; index += 1) {
    const parts = datePartsInZone(new Date(timestamp), timeZone)
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    timestamp = targetUtc - (asUtc - timestamp)
  }
  return new Date(timestamp)
}

function datePartsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value)
  const hour = value("hour")
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: hour === 24 ? 0 : hour,
    minute: value("minute"),
    second: value("second"),
  }
}

function icsPerson(field: IcsProperty) {
  const value = unescapeIcsText(field.value.replace(/^mailto:/i, ""))
  return {
    email: value.includes("@") ? value : undefined,
    displayName: unescapeIcsText(field.params.CN ?? ""),
  }
}

function unescapeIcsText(value: string) {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim()
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2)
}

function bestCalendarCandidate(candidates: CalendarMatch[], meetingStart: Date, meetingName: string, meetingPeople: string[]) {
  const scored = candidates.map(candidate => {
    const diffMinutes = Math.abs(candidate.timestamp.getTime() - meetingStart.getTime()) / 60000
    const timeScore = Math.max(0, 70 - diffMinutes)
    const titleScore = tokenOverlap(meetingName, candidate.name) * 15
    const attendeeScore = overlapCount(meetingPeople, normalizePeople(candidate.attendees)) * 10
    return { ...candidate, score: timeScore + titleScore + attendeeScore }
  })
  const best = scored.sort((a, b) => b.score - a.score)[0]
  return best && best.score >= 35 ? best : null
}

async function googleAccessToken(connection: {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
}) {
  if (connection.accessToken && (!connection.expiresAt || connection.expiresAt.getTime() > Date.now() + 60000)) {
    return connection.accessToken
  }
  if (!connection.refreshToken) throw new Error("Google Calendar connection has no refresh token")
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error("Google Calendar OAuth credentials are missing")
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status})`)
  const body = asRecord(await response.json())
  if (typeof body?.access_token !== "string") throw new Error("Google token refresh returned no access token")
  return body.access_token
}

async function fetchGoogleCalendarCandidates(accessToken: string, calendarId: string, timeMin: Date, timeMax: Date) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`)
  url.searchParams.set("timeMin", timeMin.toISOString())
  url.searchParams.set("timeMax", timeMax.toISOString())
  url.searchParams.set("singleEvents", "true")
  url.searchParams.set("orderBy", "startTime")
  url.searchParams.set("maxResults", "50")
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error(`Google Calendar lookup failed (${response.status})`)
  const body = asRecord(await response.json())
  const items = Array.isArray(body?.items) ? body.items : []
  return items.flatMap(item => {
    const record = asRecord(item)
    const start = asRecord(record?.start)
    const timestampValue = start?.dateTime ?? start?.date
    if (!record || typeof record.id !== "string" || typeof timestampValue !== "string") return []
    const timestamp = new Date(timestampValue)
    if (Number.isNaN(timestamp.getTime())) return []
    return [{
      eventId: null,
      externalEventId: record.id,
      name: typeof record.summary === "string" ? record.summary : "Untitled Google Calendar event",
      timestamp,
      attendees: normalizeCalendarAttendees(record.attendees),
      score: 0,
    }]
  })
}

async function splitMeeting(meeting: KrispMeeting, transcript: string, calendarMatch: CalendarMatch | null, customers: Customer[]): Promise<Segment[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured")
  const anthropic = new Anthropic({ apiKey })
  const customerList = customers
    .map(customer => `${customer.slug}: ${customer.name} (aliases: ${customer.aliases.join(", ")})`)
    .join("\n")
  const accountAliases = [
    "Tio, Taio, and Taiyo -> taiyo",
    "Teco and Toyota Industries -> tico",
    "TMC and Toyota Motor Company -> tmc",
    "SD Digital Twin -> estee-lauder",
    "Xerox and Lexmark -> xerox-lexmark",
  ].join("\n")
  const routingHints = customerRoutingHints(meeting, transcript)
  const calendarContext = calendarMatch
    ? `${calendarMatch.name}; ${calendarMatch.timestamp.toISOString()}; attendees: ${calendarMatch.attendees.map(person => person.displayName || person.email).filter(Boolean).join(", ")}`
    : "No reliable calendar match"

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 5000,
    temperature: 0,
    messages: [{
      role: "user",
      content: `Process this Krisp meeting for Team OS.

Rules:
- Split a mixed meeting into one segment per substantively discussed customer.
- Preserve customer-specific decisions and action items only in that customer's segment.
- Put company operations, personnel, health, culture, and other private discussion in an internal segment.
- A customer must be a sustained topic of discussion, not merely named.
- A portfolio roll call, coverage list, brief status update, or one-off action about another account ALWAYS stays in the internal segment.
- Set substantive true only when the customer is discussed for a sustained portion of the meeting, roughly 90 seconds or several back-and-forth turns.
- Set substantive false for incidental account mentions, even when they contain a small action item.
- For each customer segment, evidence must contain at least three exact 5-15 word excerpts from distinct transcript turns. Do not paraphrase evidence.
- Use only customer slugs from the list below. Never invent or guess a customer.
- If the correct customer is uncertain, use destination "review" and customerSlug null.
- confidence is 0 to 1 and reflects confidence in the destination mapping.
- Return JSON only, as an array of objects with keys: destination, customerSlug, confidence, substantive, evidence, title, keyPoints, decisions, actionItems, notes.

Known customers:
${customerList}

Confirmed account aliases:
${accountAliases}

Customer routing hints:
${routingHints}

Krisp metadata:
- ID: ${meeting.meeting_id}
- Title: ${meeting.name}
- Date: ${meeting.date}
- Speakers/attendees: ${normalizePeople([...(meeting.attendees ?? []), ...(meeting.speakers ?? [])]).join(", ")}

Matched calendar event:
${calendarContext}

Transcript:
${transcript.slice(0, 120000)}`,
    }],
  })
  const text = response.content.filter(block => block.type === "text").map(block => block.text).join("\n")
  const parsed = JSON.parse(extractJson(text))
  if (!Array.isArray(parsed)) throw new Error("Meeting processor did not return an array")
  return parsed.map(parseSegment)
}

function customerRoutingHints(meeting: KrispMeeting, transcript: string) {
  const attendees = normalizePeople([...(meeting.attendees ?? []), ...(meeting.speakers ?? [])]).join(" ")
  const text = `${meeting.name}\n${attendees}\n${transcript.slice(0, 40000)}`.toLowerCase()
  const hints: string[] = []
  const xeroxSignals = ["csu", "orion", "eduardo", "guillermo", "shop floor", "cycle time", "station", "dashboard", "data validation", "line idle", "downtime"]
  if (text.includes("ulysses") && xeroxSignals.some(signal => text.includes(signal))) {
    hints.push("Ulysses plus CSU, Orion, Eduardo, shop-floor, cycle-time, station, dashboard, downtime, or data-validation discussion is a Xerox/Lexmark signal -> xerox-lexmark.")
  }
  return hints.length ? hints.join("\n") : "None"
}

function normalizeSegments(segments: Segment[], meeting: KrispMeeting, customers: Customer[], transcript: string) {
  const slugs = new Set(customers.map(customer => customer.slug))
  const xeroxOverride = hasStrongXeroxSignal(meeting, transcript) && slugs.has("xerox-lexmark")
  return segments.map(segment => {
    const evidenceCount = segment.evidence.filter(excerpt => transcript.toLowerCase().includes(excerpt.toLowerCase())).length
    if (xeroxOverride && isCustomerLikeXeroxSegment(segment)) {
      return {
        ...segment,
        destination: "customer" as const,
        customerSlug: "xerox-lexmark",
        confidence: Math.max(segment.confidence, 0.9),
        substantive: true,
      }
    }
    if (segment.destination === "customer" && segment.substantive && evidenceCount >= 3 && segment.customerSlug && slugs.has(segment.customerSlug) && segment.confidence >= CUSTOMER_CONFIDENCE_THRESHOLD) return segment
    if (segment.destination === "customer" && !segment.substantive) return { ...segment, destination: "internal" as const, customerSlug: null }
    if (segment.destination === "internal") return { ...segment, customerSlug: null }
    return { ...segment, destination: "review" as const, customerSlug: null }
  })
}

function hasStrongXeroxSignal(meeting: KrispMeeting, transcript: string) {
  const attendees = normalizePeople([...(meeting.attendees ?? []), ...(meeting.speakers ?? [])]).join(" ")
  const text = `${meeting.name}\n${attendees}\n${transcript.slice(0, 40000)}`.toLowerCase()
  return text.includes("ulysses") && xeroxSignalCount(text) >= 3
}

function isCustomerLikeXeroxSegment(segment: Segment) {
  if (segment.destination === "customer") return segment.customerSlug === "xerox-lexmark"
  if (segment.destination !== "review") return false
  const text = [
    segment.title,
    ...segment.keyPoints,
    ...segment.decisions,
    ...segment.actionItems,
    ...segment.notes,
  ].join("\n").toLowerCase()
  return xeroxSignalCount(text) >= 2
}

function xeroxSignalCount(text: string) {
  const signals = ["csu", "orion", "eduardo", "guillermo", "shop floor", "cycle time", "station", "dashboard", "data validation", "line idle", "downtime"]
  return signals.filter(signal => text.includes(signal)).length
}

function writeSegment(meeting: KrispMeeting, segment: Segment, calendarMatch: CalendarMatch | null) {
  const date = isoDate(meeting.date)
  const slug = slugify(segment.title || meeting.name) || "meeting"
  const baseDir = segment.destination === "customer" && segment.customerSlug
    ? path.join(TEAM_OS_ROOT, "customers", segment.customerSlug, "meetings")
    : segment.destination === "internal"
      ? path.join(TEAM_OS_ROOT, "personal-drawer/meetings")
      : path.join(TEAM_OS_ROOT, "personal-drawer/meeting-review")
  fs.mkdirSync(baseDir, { recursive: true })
  const target = uniqueMeetingPath(baseDir, `${date}-${slug}.md`, meeting.meeting_id)
  if (!target) return null

  const attendees = normalizePeople([...(meeting.attendees ?? []), ...(meeting.speakers ?? [])])
  const content = [
    `# ${segment.title || meeting.name}`,
    "",
    `**Date:** ${date}  `,
    `**Time:** ${formatTime(meeting.date)}  `,
    `**Attendees:** ${attendees.join(", ") || "Unknown"}  `,
    `**Krisp:** ${meeting.url ?? `https://app.krisp.ai/t/${meeting.meeting_id}`}  `,
    `**Calendar:** ${calendarMatch?.name ?? "No reliable match"}`,
    "",
    "## Summary",
    "",
    ...bullets(segment.keyPoints),
    "",
    "## Decisions",
    "",
    ...bullets(segment.decisions, "No explicit decisions recorded."),
    "",
    "## Action Items",
    "",
    ...bullets(segment.actionItems, "No explicit action items recorded."),
    ...(segment.notes.length ? ["", "## Notes", "", ...bullets(segment.notes)] : []),
    "",
    `<!-- krisp-meeting-id: ${meeting.meeting_id} -->`,
  ].join("\n")
  fs.writeFileSync(target, content)
  console.log(`[krisp] Wrote ${target}`)
  return target
}

function ledgerPath() {
  return path.join(TEAM_OS_ROOT, "personal-drawer/meeting-ledger.md")
}

function ledgerHeader() {
  return [
    "# Meeting Ledger",
    "",
    "Private index of Krisp-processed meeting outputs. One source meeting can have multiple rows when it is split across customers or private notes.",
    "",
    "| Date | Time | Meeting | Attendees | Customer | Destination | Calendar | Krisp | File | Key |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ].join("\n")
}

function appendLedgerRow(row: LedgerRow) {
  const target = ledgerPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : `${ledgerHeader()}\n`
  const lines = existing.split("\n")
  const filtered = lines.filter(line => !line.endsWith(`| ${escapeTable(row.key)} |`))
  filtered.push(formatLedgerRow(row))
  fs.writeFileSync(target, `${filtered.filter((line, index, array) => line.trim() || index < array.length - 1).join("\n")}\n`)
}

function ledgerRowForSegment(meeting: KrispMeeting, segment: Segment, calendarMatch: CalendarMatch | null, file: string): LedgerRow {
  const date = isoDate(meeting.date)
  const attendees = normalizePeople([...(meeting.attendees ?? []), ...(meeting.speakers ?? [])]).join(", ") || "Unknown"
  const customer = segment.destination === "customer" && segment.customerSlug ? segment.customerSlug : ""
  const destination = segment.destination === "customer" && segment.customerSlug
    ? `customers/${segment.customerSlug}`
    : segment.destination === "internal"
      ? "personal-drawer/meetings"
      : "personal-drawer/meeting-review"
  const relativeFile = path.relative(TEAM_OS_ROOT, file)
  return {
    key: `${meeting.meeting_id}:${relativeFile}`,
    date,
    time: formatTime(meeting.date),
    meeting: segment.title || meeting.name,
    attendees,
    customer,
    destination,
    calendar: calendarMatch?.name ?? "No reliable match",
    krisp: meeting.url ?? `https://app.krisp.ai/t/${meeting.meeting_id}`,
    file: relativeFile,
  }
}

function rebuildMeetingLedger() {
  const rows: LedgerRow[] = []
  for (const root of [path.join(TEAM_OS_ROOT, "customers"), path.join(TEAM_OS_ROOT, "personal-drawer/meetings"), path.join(TEAM_OS_ROOT, "personal-drawer/meeting-review")]) {
    walkMarkdown(root, file => {
      const row = ledgerRowFromMeetingFile(file)
      if (row) rows.push(row)
    })
  }
  rows.sort((a, b) => `${a.date} ${a.time} ${a.file}`.localeCompare(`${b.date} ${b.time} ${b.file}`))
  const target = ledgerPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${ledgerHeader()}\n${rows.map(formatLedgerRow).join("\n")}\n`)
  console.log(`[krisp] Rebuilt meeting ledger with ${rows.length} rows at ${target}`)
}

function ledgerRowFromMeetingFile(file: string): LedgerRow | null {
  const text = fs.readFileSync(file, "utf8")
  const krisp = text.match(/\*\*Krisp:\*\*\s*(https:\/\/app\.krisp\.ai\/t\/[a-f0-9]+)/)?.[1]
  if (!krisp) return null
  const id = krisp.split("/").pop() ?? ""
  const relativeFile = path.relative(TEAM_OS_ROOT, file)
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file, ".md")
  const customerMatch = relativeFile.match(/^customers\/([^/]+)\//)
  const date = normalizeMeetingDate(text.match(/\*\*Date:\*\*\s*(.+?)\s{2,}$/m)?.[1]?.trim(), file)
  const time = text.match(/\*\*Time:\*\*\s*(.+?)\s{2,}$/m)?.[1]?.trim() || ""
  const attendees = text.match(/\*\*Attendees:\*\*\s*(.+?)\s{2,}$/m)?.[1]?.trim() || "Unknown"
  const calendar = text.match(/\*\*Calendar:\*\*\s*(.+)$/m)?.[1]?.trim() || "No reliable match"
  const destination = customerMatch
    ? `customers/${customerMatch[1]}`
    : relativeFile.startsWith("personal-drawer/meeting-review/")
      ? "personal-drawer/meeting-review"
      : "personal-drawer/meetings"
  return {
    key: `${id}:${relativeFile}`,
    date,
    time,
    meeting: title,
    attendees,
    customer: customerMatch?.[1] ?? "",
    destination,
    calendar,
    krisp,
    file: relativeFile,
  }
}

function formatLedgerRow(row: LedgerRow) {
  const krispLink = row.krisp ? `[Krisp](${row.krisp})` : ""
  const fileLink = `[${row.file}](${row.file})`
  return `| ${escapeTable(row.date)} | ${escapeTable(row.time)} | ${escapeTable(row.meeting)} | ${escapeTable(row.attendees)} | ${escapeTable(row.customer)} | ${escapeTable(row.destination)} | ${escapeTable(row.calendar)} | ${krispLink} | ${fileLink} | ${escapeTable(row.key)} |`
}

function normalizeMeetingDate(value: string | undefined, file: string) {
  const filenameDate = path.basename(file).match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (!value) return filenameDate ?? ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  return filenameDate ?? value
}

function escapeTable(value: string) {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim()
}

function archiveTranscript(meeting: KrispMeeting, transcript: string, calendarMatch: CalendarMatch | null) {
  const dir = path.join(TEAM_OS_ROOT, "personal-drawer/krisp-transcripts")
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, `${isoDate(meeting.date)}-${meeting.meeting_id}.md`)
  if (fs.existsSync(target)) return
  fs.writeFileSync(target, [
    `# ${meeting.name}`,
    "",
    `- Krisp: ${meeting.url ?? `https://app.krisp.ai/t/${meeting.meeting_id}`}`,
    `- Recorded: ${meeting.date}`,
    `- Calendar: ${calendarMatch?.name ?? "No reliable match"}`,
    "",
    transcript,
  ].join("\n"))
}

async function attachTranscriptToEvent(eventId: string, meeting: KrispMeeting, transcript: string) {
  const { db } = await import("@life-os/db")
  const existing = await db.event.findUnique({ where: { id: eventId }, select: { transcript: true } })
  if (!existing) return
  const marker = `krisp-meeting-id:${meeting.meeting_id}`
  if ((existing.transcript ?? "").includes(marker)) return
  const value = [existing.transcript, `<!-- ${marker} -->`, transcript].filter(Boolean).join("\n\n")
  await db.event.update({ where: { id: eventId }, data: { transcript: value } })
}

function loadCustomers(): Customer[] {
  const root = path.join(TEAM_OS_ROOT, "customers")
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("_"))
    .map(entry => {
      const profile = path.join(root, entry.name, "profile.md")
      const text = fs.existsSync(profile) ? fs.readFileSync(profile, "utf8") : ""
      const name = frontmatterValue(text, "name") || entry.name
      return { slug: entry.name, name, aliases: Array.from(new Set([entry.name.replaceAll("-", " "), name])) }
    })
}

function scanExistingKrispUrls() {
  const urls = new Set<string>()
  for (const root of [path.join(TEAM_OS_ROOT, "customers"), path.join(TEAM_OS_ROOT, "personal-drawer")]) {
    walkMarkdown(root, file => {
      const text = fs.readFileSync(file, "utf8")
      for (const match of text.matchAll(/https:\/\/app\.krisp\.ai\/t\/[a-f0-9]+/g)) urls.add(match[0])
    })
  }
  return urls
}

function walkMarkdown(root: string, visit: (file: string) => void) {
  if (!fs.existsSync(root)) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) walkMarkdown(full, visit)
    else if (entry.name.endsWith(".md")) visit(full)
  }
}

function uniqueMeetingPath(dir: string, filename: string, meetingId: string) {
  const initial = path.join(dir, filename)
  if (!fs.existsSync(initial)) return initial
  if (fs.readFileSync(initial, "utf8").includes(meetingId)) return null
  const ext = path.extname(filename)
  const stem = filename.slice(0, -ext.length)
  for (let i = 2; i < 100; i += 1) {
    const candidate = path.join(dir, `${stem}-${i}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
    if (fs.readFileSync(candidate, "utf8").includes(meetingId)) return null
  }
  throw new Error(`Could not choose a unique filename for ${filename}`)
}

function resolveAfter(state: State, options: Options) {
  if (options.backfillDays !== null) return new Date(Date.now() - options.backfillDays * 86400000).toISOString()
  const previous = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : Date.now() - DEFAULT_LOOKBACK_MS
  return new Date(previous - OVERLAP_MS).toISOString()
}

function loadState(): State {
  if (!fs.existsSync(STATE_PATH)) return { lastCheckedAt: null, processedMeetingIds: [] }
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as Partial<State>
    return {
      lastCheckedAt: typeof parsed.lastCheckedAt === "string" ? parsed.lastCheckedAt : null,
      processedMeetingIds: Array.isArray(parsed.processedMeetingIds) ? parsed.processedMeetingIds.filter(value => typeof value === "string") : [],
    }
  } catch {
    return { lastCheckedAt: null, processedMeetingIds: [] }
  }
}

function saveState(state: State) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n")
}

function parseOptions(args: string[]): Options {
  const valueAfter = (flag: string) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
  }
  return {
    dryRun: args.includes("--dry-run"),
    reprocess: args.includes("--reprocess"),
    backfillDays: valueAfter("--backfill-days") ? Number(valueAfter("--backfill-days")) : null,
    limit: valueAfter("--limit") ? Number(valueAfter("--limit")) : 100,
    meetingId: valueAfter("--meeting-id") ?? null,
  }
}

function assertSetup() {
  if (!fs.existsSync(TEAM_OS_ROOT)) throw new Error(`Team OS not found at ${TEAM_OS_ROOT}`)
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is missing from the Persons environment")
}

function parseSegment(value: unknown): Segment {
  const record = asRecord(value) ?? {}
  const destination = record.destination === "customer" || record.destination === "internal" || record.destination === "review" ? record.destination : "review"
  return {
    destination,
    customerSlug: typeof record.customerSlug === "string" ? record.customerSlug : null,
    confidence: typeof record.confidence === "number" ? record.confidence : 0,
    substantive: record.substantive === true,
    evidence: stringArray(record.evidence),
    title: typeof record.title === "string" ? record.title : "Meeting Summary",
    keyPoints: stringArray(record.keyPoints),
    decisions: stringArray(record.decisions),
    actionItems: stringArray(record.actionItems),
    notes: stringArray(record.notes),
  }
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start < 0 || end < start) throw new Error("No JSON array found in processor response")
  return text.slice(start, end + 1)
}

function stripRecordingDownload(document: string) {
  return document.replace(/# Recording Download Link[\s\S]*?(?=## Transcript)/, "").replace(/^# .*?\n/, "").trim()
}

function normalizeCalendarAttendees(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(item => {
    const record = asRecord(item) ?? {}
    return {
      email: typeof record.email === "string" ? record.email : undefined,
      displayName: typeof record.displayName === "string" ? record.displayName : undefined,
    }
  })
}

function normalizePeople(values: unknown[]) {
  return Array.from(new Set(values.flatMap(value => {
    if (typeof value === "string") return [value.trim()]
    const record = asRecord(value)
    if (!record) return []
    const candidate = record.displayName ?? record.name ?? record.email
    return typeof candidate === "string" ? [candidate.trim()] : []
  }).filter(Boolean)))
}

function overlapCount(left: string[], right: string[]) {
  const normalized = new Set(left.map(value => value.toLowerCase()))
  return right.filter(value => normalized.has(value.toLowerCase())).length
}

function tokenOverlap(left: string, right: string) {
  const tokens = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
  const a = tokens(left)
  const b = tokens(right)
  if (!a.size || !b.size) return 0
  return [...a].filter(token => b.has(token)).length / Math.max(a.size, b.size)
}

function parseJson(value: string | null): JsonRecord {
  if (!value) return {}
  try { return asRecord(JSON.parse(value)) ?? {} } catch { return {} }
}

function frontmatterValue(text: string, key: string) {
  const match = text.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m"))
  return match?.[1]?.replace(/["']$/, "").trim() ?? ""
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean) : []
}

function bullets(items: string[], fallback?: string) {
  return (items.length ? items : fallback ? [fallback] : []).map(item => `- ${item}`)
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)
}

function isoDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: "America/Los_Angeles" })
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null
}

function isMeeting(value: unknown): value is KrispMeeting {
  const record = asRecord(value)
  return Boolean(record && typeof record.meeting_id === "string" && typeof record.name === "string" && typeof record.date === "string")
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

main().catch(error => {
  console.error(`[krisp] ${errorMessage(error)}`)
  process.exitCode = 1
})
