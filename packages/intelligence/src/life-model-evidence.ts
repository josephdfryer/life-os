// Bounded, workspace-wide evidence for whole-life synthesis — the
// counterpart to evidence.ts's per-person bundle. Every line is tagged
// `[sourceType:sourceId ...]` with the record's real database id, so the
// model can copy sourceType/sourceId verbatim into each claim's evidence
// array (see life-model.ts's RESPONSE_SCHEMA and the system prompt's "cite
// ... split into sourceType and sourceId" instruction).

const MAX_NOTES = 40
const MAX_INTERACTIONS = 80
const MAX_EVENTS = 40
const MAX_PLANS = 40
const MAX_STATES = 30
const MAX_PERSONS = 35
const MAX_PLACES = 30
const MAX_GROUPS = 25
const MAX_ITEMS = 30
const MAX_FEEDBACK = 40
const NOTE_CONTENT_CHARS = 800

export async function buildLifeModelEvidence(workspaceId: string): Promise<string> {
  const { db } = await import("@life-os/db")

  const [notes, interactions, events, plans, states, persons, places, groups, items, feedback] = await Promise.all([
    db.note.findMany({
      where: { workspaceId },
      orderBy: { timestamp: "desc" },
      take: MAX_NOTES,
      select: { id: true, timestamp: true, type: true, content: true },
    }),
    db.interaction.findMany({
      where: { workspaceId },
      orderBy: { timestamp: "desc" },
      take: MAX_INTERACTIONS,
      select: { id: true, timestamp: true, type: true, direction: true, summary: true },
    }),
    db.event.findMany({
      where: { workspaceId },
      orderBy: { timestamp: "desc" },
      take: MAX_EVENTS,
      select: { id: true, timestamp: true, name: true, type: true },
    }),
    db.plan.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: MAX_PLANS,
      select: { id: true, createdAt: true, status: true, text: true },
    }),
    db.state.findMany({
      where: { workspaceId },
      orderBy: { recordedAt: "desc" },
      distinct: ["definitionId"],
      take: MAX_STATES,
      select: { id: true, recordedAt: true, severity: true, definition: { select: { value: true, description: true } } },
    }),
    db.person.findMany({
      where: { workspaceId }, orderBy: { updatedAt: "desc" }, take: MAX_PERSONS,
      select: { id: true, first: true, last: true, nickname: true, headline: true, company: true, closeness: true },
    }),
    db.place.findMany({
      where: { workspaceId }, orderBy: [{ favorite: "desc" }, { name: "asc" }], take: MAX_PLACES,
      select: { id: true, name: true, type: true, meaning: true, favorite: true },
    }),
    db.group.findMany({
      where: { workspaceId }, orderBy: { updatedAt: "desc" }, take: MAX_GROUPS,
      select: { id: true, name: true, groupType: true, notes: true },
    }),
    db.item.findMany({
      where: { workspaceId }, orderBy: { updatedAt: "desc" }, take: MAX_ITEMS,
      select: { id: true, name: true, category: true, description: true, quantity: true, placeId: true, ownedById: true },
    }),
    db.lifeModelClaimFeedback.findMany({
      where: { workspaceId }, orderBy: { createdAt: "desc" }, take: MAX_FEEDBACK,
      select: { id: true, createdAt: true, action: true, replacementStatement: true, reason: true, claim: { select: { statement: true } } },
    }),
  ])

  const sections: string[] = []

  if (feedback.length) {
    sections.push(formatSection("Human corrections and dismissals (highest authority)", feedback.map(item =>
      `[feedback:${item.id} ${dateTag(item.createdAt)}] ${item.action.toUpperCase()} original=${JSON.stringify(truncate(item.claim.statement, NOTE_CONTENT_CHARS))}${item.replacementStatement ? ` replacement=${JSON.stringify(truncate(item.replacementStatement, NOTE_CONTENT_CHARS))}` : ""}${item.reason ? ` reason=${JSON.stringify(truncate(item.reason, NOTE_CONTENT_CHARS))}` : ""}`,
    )))
  }

  if (notes.length) {
    sections.push(formatSection("Notes", notes.map(n =>
      `[note:${n.id} ${dateTag(n.timestamp)}] (${n.type}) ${truncate(n.content, NOTE_CONTENT_CHARS)}`,
    )))
  }
  if (interactions.length) {
    sections.push(formatSection("Interactions", interactions.map(i =>
      `[interaction:${i.id} ${dateTag(i.timestamp)}] ${i.type}${i.direction ? ` (${i.direction})` : ""}: ${i.summary ?? "(no summary)"}`,
    )))
  }
  if (events.length) {
    sections.push(formatSection("Events", events.map(e =>
      `[event:${e.id} ${dateTag(e.timestamp)}] ${e.type}: ${e.name}`,
    )))
  }
  if (plans.length) {
    sections.push(formatSection("Plans (declared intentions)", plans.map(p =>
      `[plan:${p.id} created ${dateTag(p.createdAt)}, ${p.status}] ${p.text}`,
    )))
  }
  if (states.length) {
    sections.push(formatSection("Latest tracked readings", states.map(s =>
      `[state:${s.id} ${dateTag(s.recordedAt)}] ${s.definition.value}${s.definition.description ? ` (${s.definition.description})` : ""}: ${s.severity ?? "n/a"}`,
    )))
  }
  if (persons.length) {
    sections.push(formatSection("People", persons.map(item =>
      `[person:${item.id}] ${[item.nickname || item.first, item.last].filter(Boolean).join(" ")}${item.headline ? ` — ${truncate(item.headline, NOTE_CONTENT_CHARS)}` : ""}${item.company ? ` at ${item.company}` : ""}; closeness=${item.closeness}`,
    )))
  }
  if (places.length) {
    sections.push(formatSection("Places", places.map(item =>
      `[place:${item.id}] ${item.name}${item.type ? ` (${item.type})` : ""}${item.favorite ? " favorite" : ""}${item.meaning ? ` — ${truncate(item.meaning, NOTE_CONTENT_CHARS)}` : ""}`,
    )))
  }
  if (groups.length) {
    sections.push(formatSection("Groups", groups.map(item =>
      `[group:${item.id}] ${item.name} (${item.groupType})${item.notes ? ` — ${truncate(item.notes, NOTE_CONTENT_CHARS)}` : ""}`,
    )))
  }
  if (items.length) {
    sections.push(formatSection("Items", items.map(item =>
      `[item:${item.id}] ${item.name}${item.category ? ` (${item.category})` : ""}; quantity=${item.quantity}${item.placeId ? ` place=${item.placeId}` : ""}${item.ownedById ? ` owner=${item.ownedById}` : ""}${item.description ? ` — ${truncate(item.description, NOTE_CONTENT_CHARS)}` : ""}`,
    )))
  }

  return sections.length ? sections.join("\n\n") : "No evidence recorded yet."
}

function formatSection(title: string, lines: string[]): string {
  return `## ${title}\n${lines.join("\n")}`
}

function dateTag(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}
