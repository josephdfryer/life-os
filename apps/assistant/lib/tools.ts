import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"
import {
  captureNote as createCapturedNote,
  createInteraction,
  createItem,
  createPlaceNote,
  createPlan,
} from "@life-os/domain"
import { getSpendBreakdown, getPlaceSpend as placeSpend, type SpendBreakdownInput } from "@/lib/finance"
import { getPersonFileEvidence, searchFileChunks as searchIndexedFileChunks } from "@life-os/files"

const TZ = "America/Los_Angeles"

// ── Tool schemas (provider-neutral JSON Schema) ───────────────────

// Capability is REQUIRED, and deliberately has no default. The guard that stops
// untrusted file content from inducing graph writes keys off this value, and its
// previous form named the two write tools that existed — so every tool added
// afterwards was permitted by default. Making this a required field turns
// "forgot to classify a new tool" into a type error instead of a silent hole.
//
//   read        — no side effects
//   write       — creates or mutates graph data
//   destructive — deletes or merges; never executed, proposed for review instead
export type ToolCapability = "read" | "write" | "destructive"

export type AssistantToolDefinition = {
  name: string
  description: string
  input_schema: Record<string, unknown>
  capability: ToolCapability
}

export const TOOLS: AssistantToolDefinition[] = [
  {
    name: "search_people",
    capability: "read",
    description: "Search Joseph's people by name, company, or email fragment. Returns compact matches with ids for use in other tools.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Name, company, or email fragment" } },
      required: ["query"],
    },
  },
  {
    name: "get_person",
    capability: "read",
    description: "Full detail for one person: profile, recent interactions, active plans. Use the id from search_people.",
    input_schema: {
      type: "object",
      properties: { personId: { type: "string" } },
      required: ["personId"],
    },
  },
  {
    name: "get_schedule",
    capability: "read",
    description: "Events for a specific date (defaults to today, Pacific time). Includes places when known.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD; omit for today" } },
      required: [],
    },
  },
  {
    name: "capture_note",
    capability: "write",
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
    capability: "write",
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
    name: "create_item",
    capability: "write",
    description: "Create a new physical belonging in Stuff (a vehicle, appliance, instrument, piece of gear). Use when Joseph refers to something he owns that search_items cannot find, so receipts, warranties and interactions can be filed against it. Returns the new itemId.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What it is, e.g. '2021 Volvo XC60'" },
        category: { type: "string", description: "e.g. vehicle, appliance, electronics" },
        brand: { type: "string" },
        model: { type: "string" },
        serialNumber: { type: "string", description: "Serial or VIN if known" },
        notes: { type: "string", description: "Anything worth preserving about it" },
        placeId: { type: "string", description: "Where it lives, from search_places" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_plan",
    capability: "write",
    description: "Record a declared intention or commitment as a Plan. Use when Joseph says he intends to do something, optionally about a specific person.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The intention, in his own words where possible" },
        personId: { type: "string", description: "Who it concerns, from search_people" },
        timescale: { type: "string", description: "e.g. this week, this quarter, someday" },
      },
      required: ["text"],
    },
  },
  {
    name: "add_place_note",
    capability: "write",
    description: "Attach a note to an existing Place — what happened there, what is stored there, what to remember about it. Find the placeId with search_places first.",
    input_schema: {
      type: "object",
      properties: {
        placeId: { type: "string", description: "From search_places" },
        body: { type: "string", description: "The note" },
      },
      required: ["placeId", "body"],
    },
  },
  {
    name: "query_finance",
    capability: "read",
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
    capability: "read",
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
        who: { type: "string", description: "Whose spending: a person's name for their own accounts, or 'us'/'family' for the whole household (members' personal spend plus joint accounts). Omit for everything." },
        limit: { type: "number", description: "Number of rows per breakdown, default 10" },
      },
      required: [],
    },
  },
  {
    name: "get_place_spend",
    capability: "read",
    description: "Spending grouped by physical place (from location-matched transactions). Optionally filter by place name.",
    input_schema: {
      type: "object",
      properties: { placeName: { type: "string" } },
      required: [],
    },
  },
  {
    name: "search_notes",
    capability: "read",
    description: "Search Joseph's captured notes (thoughts, observations, declarations).",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "list_inbox",
    capability: "read",
    description: "Preview pending review-inbox items (unmatched communications awaiting triage). Read-only.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 5" } },
      required: [],
    },
  },
  {
    name: "search_places",
    capability: "read",
    description: "Search Joseph's places by name, address, or type (city, home, room, shelf, etc). Returns compact matches with ids for use in get_place.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Name, address, or type fragment" } },
      required: ["query"],
    },
  },
  {
    name: "get_place",
    capability: "read",
    description: "Full detail for one place: hierarchy, meaning, recent notes, items stored there, recent events there. Use the id from search_places.",
    input_schema: {
      type: "object",
      properties: { placeId: { type: "string" } },
      required: ["placeId"],
    },
  },
  {
    name: "search_items",
    capability: "read",
    description: "Search Joseph's physical belongings (Stuff app) by name, category, make/model, or asset id. Returns compact matches with ids for use in get_item.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Name, category, make, model, or asset id fragment" } },
      required: ["query"],
    },
  },
  {
    name: "get_item",
    capability: "read",
    description: "Full detail for one physical item: location, owner, purchase/warranty info, and assembly (what it's inside, what's inside it). Use the id from search_items.",
    input_schema: {
      type: "object",
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
  },
  {
    name: "search_events",
    capability: "read",
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
    capability: "read",
    description: "Joseph's current 'theory of mind' synthesis for a person — a standing derived read on who they are, patterns, and context, built from their notes/interactions/events over time. Use the id from search_people.",
    input_schema: {
      type: "object",
      properties: { personId: { type: "string" } },
      required: ["personId"],
    },
  },
  {
    name: "get_alignment_signals",
    capability: "read",
    description: "Compare Joseph's declared intentions against his actual behavior to surface where they've drifted apart — relationships going cold relative to how close he says they are, and person-linked goals with no follow-through since he declared them. Use when he asks what he's neglecting, what needs attention, or wants a check-in on his stated priorities.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    // The reason the graph exists: one stream, not one page per person.
    name: "get_interactions",
    capability: "read",
    description: "Joseph's unified interaction stream — every logged thing across his whole life in one continuous list, newest first: calls, meals, meetings, messages, emails, calendar events and financial transactions. Use for 'what have I been doing', 'what happened last week', or any question that spans more than one person. Filter by type, person, place, merchant or date. This is the general feed; use get_spend_breakdown for money totals.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Filter: financial | calendar | message | email | call | meeting. Omit for everything." },
        personName: { type: "string", description: "Filter: only interactions involving this person" },
        merchant: { type: "string", description: "Filter: merchant or counterparty name contains" },
        sinceDays: { type: "number", description: "Lookback window in days, default 14" },
        limit: { type: "number", description: "Max rows, default 25 (max 100)" },
      },
      required: [],
    },
  },
  {
    name: "get_plans",
    capability: "read",
    description: "Joseph's declared intentions — goals, commitments and plans, with status and due dates. This is what he SAID he would do, as opposed to what the interaction log shows he did. Use for 'what am I committed to', 'what's overdue', or to check a goal before advising.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "draft | active | blocked | completed | abandoned. Default active." },
        personName: { type: "string", description: "Filter: plans tied to this person" },
        overdueOnly: { type: "boolean", description: "Only plans past their due date" },
        limit: { type: "number", description: "Default 20" },
      },
      required: [],
    },
  },
  {
    name: "get_states",
    capability: "read",
    description: "Point-in-time conditions recorded on people, places or projects — health readings, relationship phases, project status. Each is a timestamped fact, never overwritten, so this shows how something has changed. Use for 'how has my sleep been', 'what's the state of X', or trend questions.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filter: state type or value contains, e.g. sleep, weight, mood" },
        entityType: { type: "string", description: "Person | Place | Plan | Item" },
        sinceDays: { type: "number", description: "Lookback window, default 30" },
        limit: { type: "number", description: "Default 30" },
      },
      required: [],
    },
  },
  {
    name: "search_groups",
    capability: "read",
    description: "Collectives in Joseph's graph: his household/family, employers, and every merchant he transacts with (merchants are modelled as companies). Use to find who a group's members are, or to get total spend with a company across all time.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name fragment, e.g. Amazon, Fryer, Uber" },
        groupType: { type: "string", description: "family | employer | corporation | friend_group | community" },
        limit: { type: "number", description: "Default 15" },
      },
      required: [],
    },
  },
  {
    name: "search_file_chunks",
    capability: "read",
    description: "Search faithful extracted file passages. Returns chunk IDs and exact locators that may be cited as [chunk:ID].",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    },
  },
  {
    name: "get_file_context",
    capability: "read",
    description: "Get metadata and a keyset-paginated page of latest-version extracted chunks for one workspace-owned file. Follow nextCursor when more context is needed.",
    input_schema: { type: "object", properties: { fileId: { type: "string" }, cursor: { type: "string" }, limit: { type: "number", description: "Default 40, max 80" } }, required: ["fileId"] },
  },
  {
    name: "list_file_claims",
    capability: "read",
    description: "List cited explicit and inferred evidence claims for one file.",
    input_schema: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"] },
  },
  {
    name: "list_file_people",
    capability: "read",
    description: "List every Person mention and its role, confidence, and resolution status for one file.",
    input_schema: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"] },
  },
  {
    name: "get_person_file_evidence",
    capability: "read",
    description: "Get cited file evidence connected to a resolved Person.",
    input_schema: { type: "object", properties: { personId: { type: "string" } }, required: ["personId"] },
  },
]

// ── Executors ────────────────────────────────────────────────────

// workspaceId always comes from the authenticated caller's resolved
// membership (see requireWorkspaceAccess in lib/access.ts) — never from an
// env var or default. Every DB call below is scoped to it.
export async function executeTool(name: string, input: Record<string, unknown>, workspaceId: string, fileScope: string[] = []): Promise<string> {
  try {
    switch (name) {
      case "search_people": return await searchPeople(String(input.query ?? ""), workspaceId)
      case "get_person": return await getPerson(String(input.personId ?? ""), workspaceId)
      case "get_schedule": return await getSchedule(workspaceId, input.date ? String(input.date) : undefined)
      case "capture_note": return await captureNote(String(input.content ?? ""), input.noteType ? String(input.noteType) : "thought", workspaceId)
      case "log_interaction": return await logInteraction(String(input.personId ?? ""), String(input.type ?? "message"), String(input.summary ?? ""), workspaceId)
      case "create_item": return await createItemTool(input, workspaceId)
      case "create_plan": return await createPlanTool(input, workspaceId)
      case "add_place_note": return await addPlaceNoteTool(input, workspaceId)
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
      case "get_interactions": return await getInteractionStream(input, workspaceId)
      case "get_plans": return await getPlans(input, workspaceId)
      case "get_states": return await getStates(input, workspaceId)
      case "search_groups": return await searchGroups(input, workspaceId)
      case "search_file_chunks": return await searchFileChunksTool(input, workspaceId, fileScope)
      case "get_file_context": return await getFileContextTool(input, workspaceId, fileScope)
      case "list_file_claims": return await listFileClaimsTool(String(input.fileId ?? ""), workspaceId, fileScope)
      case "list_file_people": return await listFilePeopleTool(String(input.fileId ?? ""), workspaceId, fileScope)
      case "get_person_file_evidence": return await getPersonFileEvidenceTool(String(input.personId ?? ""), workspaceId, fileScope)
      default: return `Unknown tool: ${name}`
    }
  } catch (error) {
    return `Tool error: ${error instanceof Error ? error.message : String(error)}`
  }
}

function scopedFileWhere(fileId: string, workspaceId: string, fileScope: string[]) {
  return { id: fileId, workspaceId, archivedAt: null, ...(fileScope.length ? { id: { equals: fileId, in: fileScope } } : {}) }
}

async function searchFileChunksTool(input: Record<string, unknown>, workspaceId: string, fileScope: string[]) {
  const rows = await searchIndexedFileChunks({ workspaceId, query: String(input.query ?? ""), fileIds: fileScope, limit: clampNumber(input.limit, 12, 1, 30) })
  return JSON.stringify(rows.map(row => ({ chunkId: row.id, fileId: row.sourceFileId, filename: row.filename, locator: JSON.parse(row.locator), text: row.content })))
}

async function getFileContextTool(input: Record<string, unknown>, workspaceId: string, fileScope: string[]) {
  const fileId = String(input.fileId ?? "")
  const file = await db.importedFile.findFirst({ where: scopedFileWhere(fileId, workspaceId, fileScope), select: { id: true, filename: true, mimeType: true, processingState: true } })
  if (!file) return "File not found"
  const latest = await db.fileChunk.aggregate({ where: { workspaceId, sourceFileId: fileId }, _max: { version: true } })
  const limit = clampNumber(input.limit, 40, 1, 80)
  const cursor = typeof input.cursor === "string" && input.cursor ? input.cursor : undefined
  const chunks = await db.fileChunk.findMany({
    where: { workspaceId, sourceFileId: fileId, version: latest._max.version ?? 0 },
    orderBy: [{ ordinal: "asc" }, { id: "asc" }], take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, locator: true, content: true },
  })
  const hasMore = chunks.length > limit
  const page = hasMore ? chunks.slice(0, limit) : chunks
  return JSON.stringify({ ...file, chunks: page.map(chunk => ({ chunkId: chunk.id, locator: JSON.parse(chunk.locator), text: chunk.content })), nextCursor: hasMore ? page.at(-1)?.id ?? null : null })
}

async function listFileClaimsTool(fileId: string, workspaceId: string, fileScope: string[]) {
  const file = await db.importedFile.findFirst({ where: scopedFileWhere(fileId, workspaceId, fileScope), select: { id: true } })
  if (!file) return "File not found"
  const claims = await db.evidenceClaim.findMany({ where: { workspaceId, sourceFileId: fileId, status: { notIn: ["dismissed", "superseded", "reversed"] } }, include: { chunk: { select: { id: true, locator: true } }, subjects: { include: { mention: { select: { sourceText: true, role: true, resolutionStatus: true, resolvedPersonId: true } } } } } })
  return JSON.stringify(claims.map(claim => ({ id: claim.id, assertion: claim.assertion, classification: claim.classification, status: claim.status, exactQuote: claim.exactQuote, chunkId: claim.chunk.id, locator: JSON.parse(claim.chunk.locator), subjects: claim.subjects })))
}

async function listFilePeopleTool(fileId: string, workspaceId: string, fileScope: string[]) {
  const file = await db.importedFile.findFirst({ where: scopedFileWhere(fileId, workspaceId, fileScope), select: { id: true } })
  if (!file) return "File not found"
  return JSON.stringify(await db.fileEntityMention.findMany({ where: { workspaceId, sourceFileId: fileId, entityType: "Person" }, select: { id: true, sourceText: true, role: true, exactQuote: true, confidence: true, resolutionStatus: true, resolutionLevel: true, resolvedPerson: { select: { id: true, first: true, last: true } }, chunkId: true } }))
}

async function getPersonFileEvidenceTool(personId: string, workspaceId: string, fileScope: string[]) {
  const evidence = await getPersonFileEvidence(personId, workspaceId)
  const scoped = fileScope.length ? evidence.filter(claim => fileScope.includes(claim.sourceFileId)) : evidence
  return JSON.stringify(scoped.map(claim => ({ id: claim.id, assertion: claim.assertion, classification: claim.classification, status: claim.status, exactQuote: claim.exactQuote, chunkId: claim.chunk.id, locator: JSON.parse(claim.chunk.locator), filename: claim.sourceFile.filename })))
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

// Every assistant write goes through a domain command rather than db.* directly,
// so it publishes a GraphEvent carrying the assistant actor and is therefore
// attributable and undoable. This one previously called db.interaction.create()
// and produced no audit trail at all.
const ASSISTANT_ACTOR = { type: "assistant" as const, label: "Life OS Assistant" }

async function logInteraction(personId: string, type: string, summary: string, workspaceId: string) {
  const person = await db.person.findFirst({ where: { id: personId, workspaceId }, select: { id: true, first: true, last: true } })
  if (!person) return "Person not found — search_people first"
  await createInteraction({ personId, type, summary, timestamp: new Date().toISOString() }, workspaceId, ASSISTANT_ACTOR)
  return `Logged ${type} with ${person.first} ${person.last}: ${summary}`
}

async function createItemTool(input: Record<string, unknown>, workspaceId: string) {
  const name = String(input.name ?? "").trim()
  if (!name) return "An item needs a name"
  const item = await createItem({
    name,
    category: optionalString(input.category) ?? null,
    brand: optionalString(input.brand) ?? null,
    model: optionalString(input.model) ?? null,
    serialNumber: optionalString(input.serialNumber) ?? null,
    notes: optionalString(input.notes) ?? null,
    placeId: optionalString(input.placeId) ?? null,
  } as never, workspaceId, ASSISTANT_ACTOR)
  return `Created item ${item.id}: ${item.name}. Use it as itemId in other tools.`
}

async function createPlanTool(input: Record<string, unknown>, workspaceId: string) {
  const text = String(input.text ?? "").trim()
  if (!text) return "A plan needs text"
  const plan = await createPlan({
    text,
    personId: optionalString(input.personId),
    timescale: optionalString(input.timescale),
  }, workspaceId, ASSISTANT_ACTOR)
  return `Created plan ${plan.id}: ${plan.text}`
}

async function addPlaceNoteTool(input: Record<string, unknown>, workspaceId: string) {
  const placeId = String(input.placeId ?? "").trim()
  const body = String(input.body ?? "").trim()
  if (!placeId || !body) return "A place note needs placeId and body — search_places first"
  const note = await createPlaceNote(placeId, workspaceId, body, { actor: ASSISTANT_ACTOR })
  return `Added note to place ${placeId} (${note.id})`
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

  // "whose money" scoping — resolve a name to a person, or to the household.
  const who = optionalString(input.who)
  let scopeLabel = ""
  if (who) {
    const scope = await resolveSpendScope(who, workspaceId)
    if (!scope) return `No person or household matching "${who}"`
    if (scope.kind === "person") query.actorPersonId = scope.id
    else query.groupId = scope.id
    scopeLabel = `\nScope: ${scope.label}`
  }

  return formatSpendBreakdown(await getSpendBreakdown(query, workspaceId)) + scopeLabel
}

/**
 * "us"/"we"/"family" resolves to the household Group; a name resolves to that
 * person. Household scope covers members' personal spend plus joint spend on
 * shared accounts, which no single actorPersonId can express.
 */
async function resolveSpendScope(who: string, workspaceId: string) {
  const q = who.trim().toLowerCase()
  if (["us", "we", "our", "ours", "family", "household", "the family"].includes(q)) {
    const group = await db.group.findFirst({
      where: { workspaceId, groupType: "family" },
      select: { id: true, name: true },
    })
    return group ? { kind: "group" as const, id: group.id, label: group.name } : null
  }

  const person = await db.person.findFirst({
    where: {
      workspaceId,
      OR: [{ first: { contains: who } }, { last: { contains: who } }, { nickname: { contains: who } }],
      // Only people who actually own an account can be a spend actor.
      ownedEraAccounts: { some: {} },
    },
    select: { id: true, first: true, last: true },
  })
  return person ? { kind: "person" as const, id: person.id, label: `${person.first} ${person.last}` } : null
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
  // Place links live on Interaction.placeId, attached by the enrichment
  // reconciler — so this grows on its own as location data arrives.
  const result = await placeSpend(workspaceId, placeName)
  if (!result.places.length) return placeName ? `No place-matched spend for "${placeName}"` : "No place-matched spend yet"
  return [
    `Spend by place (${result.range.label}):`,
    ...result.places.map(row => `- ${row.name}: ${currency(row.total)} (${row.count}x)`),
  ].join("\n")
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

// ── The unified stream and the remaining primitives ──────────────
//
// Person, Place, Item, Event and Note already had tools. Plan, Group and State
// had none, and interactions were only reachable one person at a time — which
// is the exact limitation the graph was built to remove.

async function getInteractionStream(input: Record<string, unknown>, workspaceId: string) {
  const days = clampNumber(input.sinceDays, 14, 1, 3650)
  const limit = clampNumber(input.limit, 25, 1, 100)
  const since = new Date(Date.now() - days * 86_400_000)

  const personName = optionalString(input.personName)
  const person = personName
    ? await db.person.findFirst({
        where: {
          workspaceId,
          OR: [{ first: { contains: personName } }, { last: { contains: personName } }, { nickname: { contains: personName } }],
        },
        select: { id: true, first: true, last: true },
      })
    : null
  if (personName && !person) return `No person matching "${personName}"`

  const merchant = optionalString(input.merchant)
  const rows = await db.interaction.findMany({
    where: {
      workspaceId,
      // Bounded at both ends. Calendar entries run years ahead, and ordering by
      // timestamp desc without an upper bound puts 2027 reservations at the top
      // of "what have I been doing lately".
      timestamp: { gte: since, lte: new Date() },
      ...(optionalString(input.type) ? { type: optionalString(input.type) } : {}),
      ...(person ? { OR: [{ personId: person.id }, { actorPersonId: person.id }] } : {}),
      ...(merchant
        ? { OR: [{ merchantName: { contains: merchant } }, { summary: { contains: merchant } }] }
        : {}),
    },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: {
      timestamp: true, type: true, subtype: true, summary: true, merchantName: true,
      amount: true, direction: true, category: true,
      person: { select: { first: true, last: true } },
      place: { select: { name: true } },
      event: { select: { name: true } },
    },
  })
  if (!rows.length) return `No interactions in the last ${days} days matching that filter.`

  const scope = [person ? `${person.first} ${person.last}` : "", merchant ? `merchant~"${merchant}"` : ""]
    .filter(Boolean).join(" · ")
  return [
    `Interaction stream — last ${days} days${scope ? ` · ${scope}` : ""} (${rows.length} shown, newest first):`,
    ...rows.map(row => {
      const money = row.amount !== null
        ? ` ${row.direction === "received" ? "+" : "-"}${currency(centsToDollars(row.amount) ?? 0)}`
        : ""
      const who = row.person ? ` w/ ${row.person.first} ${row.person.last}` : ""
      const context = [row.place?.name, row.event?.name, row.category].filter(Boolean).join(" · ")
      const label = row.merchantName ?? row.summary ?? row.subtype ?? row.type
      return `- ${localDate(row.timestamp)} [${row.type}]${money} ${label}${who}${context ? ` (${context})` : ""}`
    }),
  ].join("\n")
}

async function getPlans(input: Record<string, unknown>, workspaceId: string) {
  const limit = clampNumber(input.limit, 20, 1, 100)
  const status = optionalString(input.status) ?? "active"
  const personName = optionalString(input.personName)
  const person = personName
    ? await db.person.findFirst({
        where: { workspaceId, OR: [{ first: { contains: personName } }, { last: { contains: personName } }] },
        select: { id: true },
      })
    : null

  const rows = await db.plan.findMany({
    where: {
      workspaceId,
      ...(status === "any" ? {} : { status: status as never }),
      ...(person ? { personId: person.id } : {}),
      ...(input.overdueOnly === true ? { dueOn: { lt: new Date() }, completedAt: null } : {}),
    },
    orderBy: [{ dueOn: "asc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      text: true, status: true, timescale: true, dueOn: true, completedAt: true,
      successSignals: true, person: { select: { first: true, last: true } },
    },
  })
  if (!rows.length) return `No ${status} plans${person ? " for that person" : ""}.`

  const now = Date.now()
  return [
    `Declared plans (${status}, ${rows.length}):`,
    ...rows.map(row => {
      const due = row.dueOn ? ` · due ${localDate(row.dueOn)}${row.dueOn.getTime() < now && !row.completedAt ? " OVERDUE" : ""}` : ""
      const who = row.person ? ` · ${row.person.first} ${row.person.last}` : ""
      // successSignals doubles as a provenance blob on calendar-derived plans;
      // a wall of sync JSON buries the plan text it is attached to.
      const signal = readableSignal(row.successSignals)
      return `- ${row.text}${due}${who}${row.timescale ? ` · ${row.timescale}` : ""}${signal}`
    }),
  ].join("\n")
}

async function getStates(input: Record<string, unknown>, workspaceId: string) {
  const days = clampNumber(input.sinceDays, 30, 1, 3650)
  const limit = clampNumber(input.limit, 30, 1, 100)
  const query = optionalString(input.query)
  const rows = await db.state.findMany({
    where: {
      workspaceId,
      recordedAt: { gte: new Date(Date.now() - days * 86_400_000) },
      ...(optionalString(input.entityType) ? { entityType: optionalString(input.entityType) } : {}),
      ...(query
        ? { definition: { OR: [{ type: { contains: query } }, { value: { contains: query } }] } }
        : {}),
    },
    orderBy: { recordedAt: "desc" },
    take: limit,
    select: {
      recordedAt: true, entityType: true, severity: true, source: true,
      definition: { select: { type: true, value: true, description: true } },
    },
  })
  if (!rows.length) return `No states recorded in the last ${days} days${query ? ` matching "${query}"` : ""}.`

  return [
    `Recorded states — last ${days} days (${rows.length}, newest first):`,
    ...rows.map(row => {
      const severity = row.severity !== null ? ` (${row.severity})` : ""
      return `- ${localDate(row.recordedAt)} ${row.definition.type}: ${row.definition.value}${severity} [${row.entityType}]`
    }),
  ].join("\n")
}

async function searchGroups(input: Record<string, unknown>, workspaceId: string) {
  const limit = clampNumber(input.limit, 15, 1, 50)
  const query = optionalString(input.query)
  const groups = await db.group.findMany({
    where: {
      workspaceId,
      ...(query ? { name: { contains: query } } : {}),
      ...(optionalString(input.groupType) ? { groupType: optionalString(input.groupType) as never } : {}),
    },
    take: limit,
    select: {
      id: true, name: true, groupType: true,
      personMembers: { select: { role: true, person: { select: { first: true, last: true } } }, take: 10 },
    },
  })
  if (!groups.length) return `No groups matching "${query ?? "any"}"`

  // Spend with a merchant is the counterparty edge, aggregated.
  const totals = await db.interactionParticipant.groupBy({
    by: ["entityId"],
    where: { workspaceId, entityType: "Group", role: "counterparty", entityId: { in: groups.map(g => g.id) } },
    _count: true,
  })
  const countById = new Map(totals.map(t => [t.entityId, t._count]))

  return [
    `Groups (${groups.length}):`,
    ...groups.map(group => {
      const members = group.personMembers.length
        ? ` · members: ${group.personMembers.map(m => `${m.person.first} ${m.person.last}${m.role ? ` (${m.role})` : ""}`).join(", ")}`
        : ""
      const transactions = countById.get(group.id)
      return `- ${group.name} [${group.groupType}]${transactions ? ` · ${transactions} transactions` : ""}${members}`
    }),
  ].join("\n")
}

/** Show a success signal only when it is prose a human wrote. */
function readableSignal(value: string | null) {
  if (!value) return ""
  const trimmed = value.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return ""
  return ` · success: ${trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed}`
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

function localDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}

// Name → capability, derived from the definitions above so the two can never
// disagree. agent.ts resolves through this and treats an unknown name as
// destructive.
export const TOOL_CAPABILITIES: Record<string, ToolCapability> =
  Object.fromEntries(TOOLS.map(tool => [tool.name, tool.capability]))
