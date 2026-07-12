import type Anthropic from "@anthropic-ai/sdk"
import { db } from "@/lib/db"
import { getSpendBreakdown, type SpendBreakdownInput } from "@/lib/finance"

const WORKSPACE_ID = process.env.LIFE_OS_WORKSPACE_ID ?? "default-workspace"
const TZ = "America/Los_Angeles"

// ── Tool schemas (Anthropic tool-use format) ─────────────────────

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_people",
    description: "Search Joseph's people by name, company, or email fragment. Returns compact matches with ids for use in other tools.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Name, company, or email fragment" } },
      required: ["query"],
    },
  },
  {
    name: "get_person",
    description: "Full detail for one person: profile, recent interactions, active plans. Use the id from search_people.",
    input_schema: {
      type: "object",
      properties: { personId: { type: "string" } },
      required: ["personId"],
    },
  },
  {
    name: "get_schedule",
    description: "Events for a specific date (defaults to today, Pacific time). Includes places when known.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD; omit for today" } },
      required: [],
    },
  },
  {
    name: "capture_note",
    description: "Capture a raw thought, observation, or declaration as a Note in Life OS. Use when Joseph wants to remember, note, or declare something.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        noteType: { type: "string", enum: ["thought", "observation", "declaration"], description: "Default thought" },
      },
      required: ["content"],
    },
  },
  {
    name: "log_interaction",
    description: "Log an interaction with a person (call, meeting, message, meal...). Use after confirming which person via search_people.",
    input_schema: {
      type: "object",
      properties: {
        personId: { type: "string" },
        type: { type: "string", description: "call | meeting | message | meal | activity" },
        summary: { type: "string" },
      },
      required: ["personId", "type", "summary"],
    },
  },
  {
    name: "query_finance",
    description: "Compatibility spending summary over the last N days. Prefer get_spend_breakdown for exact dates, named periods, and breakdown questions.",
    input_schema: {
      type: "object",
      properties: {
        sinceDays: { type: "number", description: "Lookback window in days, default 30" },
        merchant: { type: "string", description: "Filter: merchant name contains" },
        category: { type: "string", description: "Filter: category name contains (e.g. Groceries, Dining out)" },
      },
      required: [],
    },
  },
  {
    name: "get_spend_breakdown",
    description: "Read-only spend total and breakdown for a specific date or range. Use for questions like 'how much did I spend yesterday?', 'break it down by category', or 'what did I spend at restaurants last week?'.",
    input_schema: {
      type: "object",
      properties: {
        dateExpression: { type: "string", description: "Natural period: today, yesterday, this week, last week, this month, last month, last 7 days, YYYY-MM-DD, YYYY-MM, or July 2026. Default last 30 days." },
        startDate: { type: "string", description: "YYYY-MM-DD inclusive. Use with endDate for a custom range." },
        endDate: { type: "string", description: "YYYY-MM-DD inclusive. Optional when startDate is one day." },
        merchant: { type: "string", description: "Filter: merchant name contains" },
        category: { type: "string", description: "Filter: category name contains, e.g. Groceries or Dining out" },
        placeName: { type: "string", description: "Filter: matched physical place name contains" },
        limit: { type: "number", description: "Number of rows per breakdown, default 10" },
      },
      required: [],
    },
  },
  {
    name: "get_place_spend",
    description: "Spending grouped by physical place (from location-matched transactions). Optionally filter by place name.",
    input_schema: {
      type: "object",
      properties: { placeName: { type: "string" } },
      required: [],
    },
  },
  {
    name: "search_notes",
    description: "Search Joseph's captured notes (thoughts, observations, declarations).",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "list_inbox",
    description: "Preview pending review-inbox items (unmatched communications awaiting triage). Read-only.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 5" } },
      required: [],
    },
  },
]

// ── Executors ────────────────────────────────────────────────────

export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "search_people": return await searchPeople(String(input.query ?? ""))
      case "get_person": return await getPerson(String(input.personId ?? ""))
      case "get_schedule": return await getSchedule(input.date ? String(input.date) : undefined)
      case "capture_note": return await captureNote(String(input.content ?? ""), input.noteType ? String(input.noteType) : "thought")
      case "log_interaction": return await logInteraction(String(input.personId ?? ""), String(input.type ?? "message"), String(input.summary ?? ""))
      case "query_finance": return await queryFinance(Number(input.sinceDays ?? 30), input.merchant ? String(input.merchant) : undefined, input.category ? String(input.category) : undefined)
      case "get_spend_breakdown": return await spendBreakdown(input)
      case "get_place_spend": return await getPlaceSpend(input.placeName ? String(input.placeName) : undefined)
      case "search_notes": return await searchNotes(String(input.query ?? ""))
      case "list_inbox": return await listInbox(Number(input.limit ?? 5))
      default: return `Unknown tool: ${name}`
    }
  } catch (error) {
    return `Tool error: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function searchPeople(query: string) {
  if (!query.trim()) return "Empty query"
  const q = query.trim()
  const people = await db.person.findMany({
    where: {
      workspaceId: WORKSPACE_ID,
      OR: [
        { first: { contains: q } },
        { last: { contains: q } },
        { company: { contains: q } },
        { emailSearch: { contains: q.toLowerCase() } },
        { nickname: { contains: q } },
      ],
    },
    select: {
      id: true, first: true, last: true, nickname: true, company: true, closeness: true,
      interactions: { select: { timestamp: true }, orderBy: { timestamp: "desc" }, take: 1 },
    },
    take: 6,
  })
  if (!people.length) return `No people matching "${q}"`
  return people.map(p => {
    const last = p.interactions[0]?.timestamp
    return `${p.first} ${p.last}${p.nickname ? ` "${p.nickname}"` : ""} · id=${p.id} · ${p.company ?? "no company"} · closeness ${p.closeness} · last contact ${last ? daysAgo(last) : "never"}`
  }).join("\n")
}

async function getPerson(personId: string) {
  const p = await db.person.findFirst({
    where: { id: personId, workspaceId: WORKSPACE_ID },
    include: {
      interactions: { orderBy: { timestamp: "desc" }, take: 5, select: { type: true, timestamp: true, summary: true } },
      plans: { where: { status: "active" }, take: 5, select: { text: true, timescale: true } },
    },
  })
  if (!p) return "Person not found"
  const lines = [
    `${p.first} ${p.last}${p.nickname ? ` "${p.nickname}"` : ""}`,
    [p.title, p.company, p.location].filter(Boolean).join(" · "),
    p.birthday ? `Birthday: ${p.birthday}` : "",
    p.notes ? `Notes: ${p.notes.slice(0, 300)}` : "",
    p.interactions.length ? "\nRecent interactions:" : "",
    ...p.interactions.map(ix => `  - ${ix.type} ${daysAgo(ix.timestamp)}: ${(ix.summary ?? "").slice(0, 120)}`),
    p.plans.length ? "\nActive plans:" : "",
    ...p.plans.map(plan => `  - ${plan.text}${plan.timescale ? ` (${plan.timescale})` : ""}`),
  ]
  return lines.filter(Boolean).join("\n")
}

async function getSchedule(date?: string) {
  const day = date ?? new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date())
  const start = new Date(`${day}T00:00:00-07:00`)
  const end = new Date(`${day}T23:59:59-07:00`)
  const events = await db.event.findMany({
    where: { workspaceId: WORKSPACE_ID, start: { gte: start, lte: end } },
    select: { name: true, start: true, end: true, place: { select: { name: true } } },
    orderBy: { start: "asc" },
    take: 20,
  })
  if (!events.length) return `No events on ${day}`
  return events.map(e => {
    const time = e.start.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    return `${time} ${e.name}${e.place ? ` @ ${e.place.name}` : ""}`
  }).join("\n")
}

async function captureNote(content: string, noteType: string) {
  if (!content.trim()) return "Empty note"
  const type = ["thought", "observation", "declaration"].includes(noteType) ? noteType : "thought"
  const note = await db.note.create({
    data: {
      workspaceId: WORKSPACE_ID,
      timestamp: new Date(),
      type,
      content: content.trim(),
      metadata: JSON.stringify({ source: "assistant" }),
    },
  })
  return `Captured ${type} (${note.id}). It will flow into synthesis.`
}

async function logInteraction(personId: string, type: string, summary: string) {
  const person = await db.person.findFirst({ where: { id: personId, workspaceId: WORKSPACE_ID }, select: { id: true, first: true, last: true } })
  if (!person) return "Person not found — search_people first"
  await db.interaction.create({
    data: { workspaceId: WORKSPACE_ID, personId, type, timestamp: new Date(), summary },
  })
  return `Logged ${type} with ${person.first} ${person.last}: ${summary}`
}

async function queryFinance(sinceDays: number, merchant?: string, category?: string) {
  const days = Math.min(365, Math.max(1, Math.round(Number.isFinite(sinceDays) ? sinceDays : 30)))
  return formatSpendBreakdown(await getSpendBreakdown({ dateExpression: `last ${days} days`, merchant, category, limit: 8 }, WORKSPACE_ID))
}

async function spendBreakdown(input: Record<string, unknown>) {
  const query: SpendBreakdownInput = {
    dateExpression: optionalString(input.dateExpression),
    startDate: optionalString(input.startDate),
    endDate: optionalString(input.endDate),
    merchant: optionalString(input.merchant),
    category: optionalString(input.category),
    placeName: optionalString(input.placeName),
    limit: typeof input.limit === "number" ? input.limit : undefined,
  }
  return formatSpendBreakdown(await getSpendBreakdown(query, WORKSPACE_ID))
}

type SpendBreakdownResult = Awaited<ReturnType<typeof getSpendBreakdown>>

function formatSpendBreakdown(result: SpendBreakdownResult) {
  const filters = [
    result.filters.merchant ? `merchant~"${result.filters.merchant}"` : "",
    result.filters.category ? `category~"${result.filters.category}"` : "",
    result.filters.placeName ? `place~"${result.filters.placeName}"` : "",
  ].filter(Boolean)

  const heading = `Spend breakdown for ${result.range.label} (${result.range.startDate}${result.range.endDate !== result.range.startDate ? ` through ${result.range.endDate}` : ""}, ${result.range.timezone})${filters.length ? ` · ${filters.join(" · ")}` : ""}`
  if (!result.transactionCount) return `${heading}\nNo paid transactions found.`

  return [
    heading,
    `Total paid: ${currency(result.total)} across ${result.transactionCount} transaction${result.transactionCount === 1 ? "" : "s"}`,
    formatGroup("By category", result.byCategory),
    formatGroup("By merchant", result.byMerchant),
    result.byPlace.length ? formatGroup("By place", result.byPlace) : "",
    formatTransactions("Largest transactions", result.largestTransactions),
  ].filter(Boolean).join("\n\n")
}

function formatGroup(title: string, rows: Array<{ name: string; total: number; count: number }>) {
  if (!rows.length) return `${title}: none`
  return [
    `${title}:`,
    ...rows.map(row => `- ${row.name}: ${currency(row.total)} (${row.count}x)`),
  ].join("\n")
}

function formatTransactions(title: string, rows: SpendBreakdownResult["largestTransactions"]) {
  if (!rows.length) return ""
  return [
    `${title}:`,
    ...rows.map(row => {
      const suffix = [row.category, row.place].filter(Boolean).join(" · ")
      return `- ${row.date} ${row.merchant}: ${currency(row.amount)}${suffix ? ` (${suffix})` : ""}`
    }),
  ].join("\n")
}

function currency(value: number) {
  return `$${value.toFixed(2)}`
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

async function getPlaceSpend(placeName?: string) {
  const [rows, places] = await Promise.all([
    db.stagedInteraction.findMany({
      where: { workspaceId: WORKSPACE_ID, source: "era" },
      select: { contactName: true, metadata: true },
    }),
    db.place.findMany({
      where: { workspaceId: WORKSPACE_ID, googlePlaceId: { not: null } },
      select: { name: true, googlePlaceId: true },
    }),
  ])
  const nameByGoogleId = new Map(places.map(p => [p.googlePlaceId!, p.name]))
  const byPlace = new Map<string, { total: number; count: number }>()
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.metadata ?? "{}") as { amount?: number; placeMatch?: { band?: string; merchantPlace?: { googlePlaceId?: string | null; name?: string } | null } }
      const match = meta.placeMatch
      if (!match?.merchantPlace?.googlePlaceId || !["auto", "adjudicated"].includes(match.band ?? "")) continue
      const name = nameByGoogleId.get(match.merchantPlace.googlePlaceId) ?? match.merchantPlace.name ?? "unknown"
      if (placeName && !name.toLowerCase().includes(placeName.toLowerCase())) continue
      const entry = byPlace.get(name) ?? { total: 0, count: 0 }
      entry.total += meta.amount ?? 0
      entry.count += 1
      byPlace.set(name, entry)
    } catch { /* skip */ }
  }
  if (!byPlace.size) return placeName ? `No place-matched spend for "${placeName}"` : "No place-matched spend yet"
  return [...byPlace.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 12)
    .map(([name, v]) => `${name}: $${v.total.toFixed(2)} (${v.count}x)`)
    .join("\n")
}

async function searchNotes(query: string) {
  const notes = await db.note.findMany({
    where: { workspaceId: WORKSPACE_ID, content: { contains: query } },
    orderBy: { timestamp: "desc" },
    take: 5,
    select: { type: true, timestamp: true, content: true },
  })
  if (!notes.length) return `No notes matching "${query}"`
  return notes.map(n => `[${n.type} · ${daysAgo(n.timestamp)}] ${n.content.slice(0, 200)}`).join("\n---\n")
}

async function listInbox(limit: number) {
  const items = await db.stagedInteraction.findMany({
    where: { workspaceId: WORKSPACE_ID, status: "pending", type: { not: "financial" } },
    orderBy: { createdAt: "desc" },
    take: Math.min(10, Math.max(1, limit)),
    select: { contactName: true, contactEmail: true, summary: true, source: true, timestamp: true },
  })
  const total = await db.stagedInteraction.count({ where: { workspaceId: WORKSPACE_ID, status: "pending", type: { not: "financial" } } })
  if (!total) return "Inbox is clear"
  return [
    `${total} pending items. Most recent:`,
    ...items.map(i => `- [${i.source}] ${i.contactName ?? i.contactEmail ?? "unknown"} ${daysAgo(i.timestamp)}: ${(i.summary ?? "").slice(0, 100)}`),
  ].join("\n")
}

function daysAgo(date: Date) {
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  return `${days}d ago`
}
