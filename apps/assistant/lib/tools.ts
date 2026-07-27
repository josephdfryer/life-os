import type Anthropic from "@anthropic-ai/sdk"
import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"
import { captureNote as createCapturedNote } from "@life-os/domain"
import { getSpendBreakdown, type SpendBreakdownInput } from "@/lib/finance"

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
  {
    name: "search_places",
    description: "Search Joseph's places by name, address, or type (city, home, room, shelf, etc). Returns compact matches with ids for use in get_place.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Name, address, or type fragment" } },
      required: ["query"],
    },
  },
  {
    name: "get_place",
    description: "Full detail for one place: hierarchy, meaning, recent notes, items stored there, recent events there. Use the id from search_places.",
    input_schema: {
      type: "object",
      properties: { placeId: { type: "string" } },
      required: ["placeId"],
    },
  },
  {
    name: "search_items",
    description: "Search Joseph's physical belongings (Stuff app) by name, category, make/model, or asset id. Returns compact matches with ids for use in get_item.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Name, category, make, model, or asset id fragment" } },
      required: ["query"],
    },
  },
  {
    name: "get_item",
    description: "Full detail for one physical item: location, owner, purchase/warranty info, and assembly (what it's inside, what's inside it). Use the id from search_items.",
    input_schema: {
      type: "object",
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
  },
  {
    name: "search_events",
    description: "Keyword search over Joseph's events/calendar within a lookback window — use for 'when did I last...' or finding a specific past/future event by name, unlike get_schedule which only covers one day.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Event name/notes fragment" },
        sinceDays: { type: "number", description: "Lookback window in days, default 90" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_theory",
    description: "Joseph's current 'theory of mind' synthesis for a person — a standing derived read on who they are, patterns, and context, built from their notes/interactions/events over time. Use the id from search_people.",
    input_schema: {
      type: "object",
      properties: { personId: { type: "string" } },
      required: ["personId"],
    },
  },
  {
    name: "get_alignment_signals",
    description: "Compare Joseph's declared intentions against his actual behavior to surface where they've drifted apart — relationships going cold relative to how close he says they are, and person-linked goals with no follow-through since he declared them. Use when he asks what he's neglecting, what needs attention, or wants a check-in on his stated priorities.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
]

// ── Executors ────────────────────────────────────────────────────

// workspaceId always comes from the authenticated caller's resolved
// membership (see requireWorkspaceAccess in lib/access.ts) — never from an
// env var or default. Every DB call below is scoped to it.
export async function executeTool(name: string, input: Record<string, unknown>, workspaceId: string): Promise<string> {
  try {
    switch (name) {
      case "search_people": return await searchPeople(String(input.query ?? ""), workspaceId)
      case "get_person": return await getPerson(String(input.personId ?? ""), workspaceId)
      case "get_schedule": return await getSchedule(workspaceId, input.date ? String(input.date) : undefined)
      case "capture_note": return await captureNote(String(input.content ?? ""), input.noteType ? String(input.noteType) : "thought", workspaceId)
      case "log_interaction": return await logInteraction(String(input.personId ?? ""), String(input.type ?? "message"), String(input.summary ?? ""), workspaceId)
      case "query_finance": return await queryFinance(Number(input.sinceDays ?? 30), workspaceId, input.merchant ? String(input.merchant) : undefined, input.category ? String(input.category) : undefined)
      case "get_spend_breakdown": return await spendBreakdown(input, workspaceId)
      case "get_place_spend": return await getPlaceSpend(workspaceId, input.placeName ? String(input.placeName) : undefined)
      case "search_notes": return await searchNotes(String(input.query ?? ""), workspaceId)
      case "list_inbox": return await listInbox(Number(input.limit ?? 5), workspaceId)
      case "search_places": return await searchPlaces(String(input.query ?? ""), workspaceId)
      case "get_place": return await getPlace(String(input.placeId ?? ""), workspaceId)
      case "search_items": return await searchItems(String(input.query ?? ""), workspaceId)
      case "get_item": return await getItem(String(input.itemId ?? ""), workspaceId)
      case "search_events": return await searchEvents(String(input.query ?? ""), Number(input.sinceDays ?? 90), workspaceId)
      case "get_theory": return await getTheory(String(input.personId ?? ""), workspaceId)
      case "get_alignment_signals": return await getAlignmentSignalsTool(workspaceId)
      default: return `Unknown tool: ${name}`
    }
  } catch (error) {
    return `Tool error: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function searchPeople(query: string, workspaceId: string) {
  if (!query.trim()) return "Empty query"
  const q = query.trim()
  const parts = q.split(/\s+/)

  // Build OR clauses — also handle "First Last" full-name queries by matching parts individually
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orClauses: any[] = [
    { first: { contains: q } },
    { last: { contains: q } },
    { company: { contains: q } },
    { emailSearch: { contains: q.toLowerCase() } },
    { nickname: { contains: q } },
  ]
  if (parts.length >= 2) {
    // "Joseph Fryer" → first contains "Joseph" AND last contains "Fryer"
    orClauses.push({ AND: [{ first: { contains: parts[0] } }, { last: { contains: parts[parts.length - 1] } }] })
  }

  const people = await db.person.findMany({
    where: { workspaceId, OR: orClauses },
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

async function getPerson(personId: string, workspaceId: string) {
  const [p, recentStates] = await Promise.all([
    db.person.findFirst({
      where: { id: personId, workspaceId },
      include: {
        interactions: { orderBy: { timestamp: "desc" }, take: 5, select: { type: true, timestamp: true, summary: true } },
        plans: { where: { status: "active" }, take: 5, select: { text: true, timescale: true } },
      },
    }),
    // Fetch most recent state per type (health metrics, capacity, etc.)
    db.state.findMany({
      where: { entityId: personId, workspaceId },
      include: { definition: { select: { type: true, value: true } } },
      orderBy: { recordedAt: "desc" },
      take: 30,
    }),
  ])
  if (!p) return "Person not found"

  // Dedupe states — keep most recent per (type, value) pair
  const latestByType = new Map<string, { value: string; severity: number | null; recordedAt: Date }>()
  for (const s of recentStates) {
    const key = s.definition.type
    if (!latestByType.has(key)) {
      latestByType.set(key, { value: s.definition.value, severity: s.severity, recordedAt: s.recordedAt })
    }
  }

  const stateLines = [...latestByType.entries()].map(([type, s]) => {
    const val = s.severity !== null ? `${s.value} (${s.severity})` : s.value
    return `  ${type}: ${val} as of ${s.recordedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
  })

  const lines = [
    `${p.first} ${p.last}${p.nickname ? ` "${p.nickname}"` : ""}`,
    [p.title, p.company, p.location].filter(Boolean).join(" · "),
    p.birthday ? `Birthday: ${p.birthday}` : "",
    p.notes ? `Notes: ${p.notes.slice(0, 300)}` : "",
    stateLines.length ? "\nCurrent state data:" : "",
    ...stateLines,
    p.interactions.length ? "\nRecent interactions:" : "",
    ...p.interactions.map(ix => `  - ${ix.type} ${daysAgo(ix.timestamp)}: ${(ix.summary ?? "").slice(0, 120)}`),
    p.plans.length ? "\nActive plans:" : "",
    ...p.plans.map(plan => `  - ${plan.text}${plan.timescale ? ` (${plan.timescale})` : ""}`),
  ]
  return lines.filter(Boolean).join("\n")
}

async function getSchedule(workspaceId: string, date?: string) {
  const day = date ?? new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date())
  const start = new Date(`${day}T00:00:00-07:00`)
  const end = new Date(`${day}T23:59:59-07:00`)
  const events = await db.event.findMany({
    where: { workspaceId, start: { gte: start, lte: end } },
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

async function captureNote(content: string, noteType: string, workspaceId: string) {
  const { note } = await createCapturedNote({
    workspaceId,
    content,
    type: noteType,
    source: "assistant",
  })
  return `Captured ${note.type} (${note.id}). It will flow into synthesis.`
}

async function logInteraction(personId: string, type: string, summary: string, workspaceId: string) {
  const person = await db.person.findFirst({ where: { id: personId, workspaceId }, select: { id: true, first: true, last: true } })
  if (!person) return "Person not found — search_people first"
  await db.interaction.create({
    data: { workspaceId, personId, type, timestamp: new Date(), summary },
  })
  return `Logged ${type} with ${person.first} ${person.last}: ${summary}`
}

async function queryFinance(sinceDays: number, workspaceId: string, merchant?: string, category?: string) {
  const days = Math.min(365, Math.max(1, Math.round(Number.isFinite(sinceDays) ? sinceDays : 30)))
  return formatSpendBreakdown(await getSpendBreakdown({ dateExpression: `last ${days} days`, merchant, category, limit: 8 }, workspaceId))
}

async function spendBreakdown(input: Record<string, unknown>, workspaceId: string) {
  const query: SpendBreakdownInput = {
    dateExpression: optionalString(input.dateExpression),
    startDate: optionalString(input.startDate),
    endDate: optionalString(input.endDate),
    merchant: optionalString(input.merchant),
    category: optionalString(input.category),
    placeName: optionalString(input.placeName),
    limit: typeof input.limit === "number" ? input.limit : undefined,
  }
  return formatSpendBreakdown(await getSpendBreakdown(query, workspaceId))
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

async function getPlaceSpend(workspaceId: string, placeName?: string) {
  const [rows, places] = await Promise.all([
    db.stagedInteraction.findMany({
      where: { workspaceId, source: "era" },
      select: { contactName: true, metadata: true },
    }),
    db.place.findMany({
      where: { workspaceId, googlePlaceId: { not: null } },
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

async function searchNotes(query: string, workspaceId: string) {
  const notes = await db.note.findMany({
    where: { workspaceId, content: { contains: query } },
    orderBy: { timestamp: "desc" },
    take: 5,
    select: { type: true, timestamp: true, content: true, metadata: true },
  })
  if (!notes.length) return `No notes matching "${query}"`
  return notes.map(n => `[${n.type} · ${daysAgo(n.timestamp)}] ${formatNoteBody(n)}`).join("\n---\n")
}

// Long captured Notes (documents, voice transcripts, photo digests) get a
// lightweight LLM fact extraction pass (scripts/synthesis/note-facts.ts) that
// lands in metadata.extraction — prefer that compact form over dumping the
// first 200 characters of, say, a 200,000-character lease agreement.
function formatNoteBody(note: { content: string; metadata: string | null }): string {
  const extraction = parseExtraction(note.metadata)
  if (!extraction) return note.content.slice(0, 200)

  const factsLine = extraction.facts.map(f => `${f.key}: ${f.value}`).join(" · ")
  return [extraction.summary, factsLine].filter(Boolean).join("\n  ")
}

function parseExtraction(metadata: string | null): { summary: string; facts: Array<{ key: string; value: string }> } | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as { extraction?: { summary?: string; facts?: Array<{ key: string; value: string }> } }
    if (!parsed.extraction?.summary) return null
    return { summary: parsed.extraction.summary, facts: parsed.extraction.facts ?? [] }
  } catch {
    return null
  }
}

async function listInbox(limit: number, workspaceId: string) {
  const items = await db.stagedInteraction.findMany({
    where: { workspaceId, status: "pending", type: { not: "financial" } },
    orderBy: { createdAt: "desc" },
    take: Math.min(10, Math.max(1, limit)),
    select: { contactName: true, contactEmail: true, summary: true, source: true, timestamp: true },
  })
  const total = await db.stagedInteraction.count({ where: { workspaceId, status: "pending", type: { not: "financial" } } })
  if (!total) return "Inbox is clear"
  return [
    `${total} pending items. Most recent:`,
    ...items.map(i => `- [${i.source}] ${i.contactName ?? i.contactEmail ?? "unknown"} ${daysAgo(i.timestamp)}: ${(i.summary ?? "").slice(0, 100)}`),
  ].join("\n")
}

async function searchPlaces(query: string, workspaceId: string) {
  if (!query.trim()) return "Empty query"
  const q = query.trim()
  const places = await db.place.findMany({
    where: {
      workspaceId,
      OR: [{ name: { contains: q } }, { address: { contains: q } }, { type: { contains: q } }],
    },
    select: {
      id: true, name: true, type: true, address: true, favorite: true,
      parentPlace: { select: { name: true } },
    },
    take: 8,
  })
  if (!places.length) return `No places matching "${q}"`
  return places.map(p =>
    `${p.name}${p.favorite ? " ★" : ""} · id=${p.id} · ${p.type ?? "unknown type"}${p.parentPlace ? ` · in ${p.parentPlace.name}` : ""}${p.address ? ` · ${p.address}` : ""}`
  ).join("\n")
}

async function getPlace(placeId: string, workspaceId: string) {
  const place = await db.place.findFirst({
    where: { id: placeId, workspaceId },
    include: {
      parentPlace: { select: { name: true } },
      childPlaces: { select: { name: true }, take: 10 },
      notes: { orderBy: { createdAt: "desc" }, take: 5, select: { body: true, createdAt: true } },
      items: { select: { name: true, category: true }, take: 15 },
      events: { orderBy: { start: "desc" }, take: 5, select: { name: true, start: true } },
    },
  })
  if (!place) return "Place not found"

  const lines = [
    `${place.name}${place.favorite ? " ★ favorite" : ""}`,
    [place.type, place.address].filter(Boolean).join(" · "),
    place.meaning ? `Meaning: ${place.meaning}` : "",
    place.parentPlace ? `In: ${place.parentPlace.name}` : "",
    place.childPlaces.length ? `Contains: ${place.childPlaces.map(c => c.name).join(", ")}` : "",
    place.items.length ? "\nItems here:" : "",
    ...place.items.map(i => `  - ${i.name}${i.category ? ` (${i.category})` : ""}`),
    place.notes.length ? "\nRecent notes:" : "",
    ...place.notes.map(n => `  - ${daysAgo(n.createdAt)}: ${n.body.slice(0, 150)}`),
    place.events.length ? "\nRecent events here:" : "",
    ...place.events.map(e => `  - ${e.name} (${daysAgo(e.start)})`),
  ]
  return lines.filter(Boolean).join("\n")
}

async function searchItems(query: string, workspaceId: string) {
  if (!query.trim()) return "Empty query"
  const q = query.trim()
  const items = await db.item.findMany({
    where: {
      workspaceId,
      OR: [
        { name: { contains: q } }, { category: { contains: q } },
        { make: { contains: q } }, { model: { contains: q } }, { assetId: { contains: q } },
      ],
    },
    select: { id: true, name: true, category: true, assetId: true, place: { select: { name: true } } },
    take: 8,
  })
  if (!items.length) return `No items matching "${q}"`
  return items.map(i =>
    `${i.name} · id=${i.id} · ${i.assetId}${i.category ? ` · ${i.category}` : ""}${i.place ? ` · at ${i.place.name}` : " · no location set"}`
  ).join("\n")
}

async function getItem(itemId: string, workspaceId: string) {
  const item = await db.item.findFirst({
    where: { id: itemId, workspaceId },
    include: {
      place: { select: { name: true } },
      ownedBy: { select: { first: true, last: true } },
      components: { where: { disassembledAt: null }, select: { childItem: { select: { name: true } } } },
      assembledInto: { where: { disassembledAt: null }, select: { parentItem: { select: { name: true } } } },
    },
  })
  if (!item) return "Item not found"

  const lines = [
    `${item.name} (${item.assetId})`,
    [item.category, item.make, item.model].filter(Boolean).join(" · "),
    item.serialNumber ? `Serial: ${item.serialNumber}` : "",
    item.assembledInto.length
      ? `Currently inside: ${item.assembledInto.map(a => a.parentItem.name).join(", ")}`
      : item.place ? `Location: ${item.place.name}` : "Location: not set",
    item.ownedBy ? `Owner: ${item.ownedBy.first} ${item.ownedBy.last}` : "",
    item.components.length ? `Contains: ${item.components.map(c => c.childItem.name).join(", ")}` : "",
    item.purchaseDate ? `Purchased: ${item.purchaseDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${item.purchasePrice ? ` for $${centsToDollars(item.purchasePrice)}` : ""}${item.purchaseFrom ? ` from ${item.purchaseFrom}` : ""}` : "",
    item.lifetimeWarranty ? "Warranty: lifetime" : item.warrantyExpires ? `Warranty until ${item.warrantyExpires.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "",
    item.notes ? `Notes: ${item.notes.slice(0, 300)}` : "",
  ]
  return lines.filter(Boolean).join("\n")
}

async function searchEvents(query: string, sinceDays: number, workspaceId: string) {
  if (!query.trim()) return "Empty query"
  const q = query.trim()
  const days = Math.min(730, Math.max(1, Math.round(Number.isFinite(sinceDays) ? sinceDays : 90)))
  const since = new Date(Date.now() - days * 86400000)
  const events = await db.event.findMany({
    where: {
      workspaceId,
      start: { gte: since },
      OR: [{ name: { contains: q } }, { notes: { contains: q } }],
    },
    select: { name: true, type: true, start: true, place: { select: { name: true } } },
    orderBy: { start: "desc" },
    take: 10,
  })
  if (!events.length) return `No events matching "${q}" in the last ${days} days`
  return events.map(e => {
    const when = e.start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    return `${when} · ${e.name}${e.place ? ` @ ${e.place.name}` : ""}`
  }).join("\n")
}

async function getTheory(personId: string, workspaceId: string) {
  const theory = await db.theorySnapshot.findFirst({
    where: { subjectPersonId: personId, workspaceId, status: "current" },
    orderBy: { version: "desc" },
    select: { title: true, summary: true, markdownBody: true, confidence: true, synthesizedAt: true },
  })
  if (!theory) return "No theory synthesized for this person yet"
  return [
    `${theory.title}${theory.confidence != null ? ` (confidence ${Math.round(theory.confidence * 100)}%)` : ""}`,
    `Synthesized ${daysAgo(theory.synthesizedAt)}`,
    "",
    theory.summary,
    "",
    theory.markdownBody.slice(0, 1500),
  ].join("\n")
}

async function getAlignmentSignalsTool(workspaceId: string) {
  const { getAlignmentSignals } = await import("@life-os/alignment")
  const signals = await getAlignmentSignals(workspaceId)
  if (!signals.length) return "No gaps detected — relationships and person-linked plans are all on track."
  return signals
    .map(s => `[${s.kind}] ${s.subject}: ${s.detail} (${s.severity.toFixed(1)}x threshold)`)
    .join("\n")
}

function daysAgo(date: Date) {
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  return `${days}d ago`
}
