import type { TheorySourceBundle } from "./types"

// getTheorySourcesForPerson (sources.ts) returns IDs and counts — the right
// shape for a provenance trail, but a real synthesis prompt needs the actual
// content. This queries it, bounded well below sources.ts's own 500/200/200/
// 500 provenance caps: those bound what's tracked as evidence, this bounds
// what reasonably fits in a prompt. Caps are named constants, not baked into
// the logic, so they're a one-line tuning change once real evidence volume
// is observed.

const MAX_NOTES = 30
const MAX_INTERACTIONS = 100
const MAX_EVENTS = 50
const MAX_PLANS = 30
const NOTE_CONTENT_CHARS = 1_000

export async function buildEvidenceText(bundle: TheorySourceBundle, workspaceId: string): Promise<string> {
  const { db } = await import("@life-os/db")

  const [notes, interactions, events, plans, states, fileClaims] = await Promise.all([
    bundle.noteIds.length
      ? db.note.findMany({
          where: { id: { in: bundle.noteIds }, workspaceId },
          orderBy: { timestamp: "desc" },
          take: MAX_NOTES,
          select: { timestamp: true, type: true, content: true },
        })
      : [],
    bundle.interactionIds.length
      ? db.interaction.findMany({
          where: { id: { in: bundle.interactionIds }, workspaceId },
          orderBy: { timestamp: "desc" },
          take: MAX_INTERACTIONS,
          select: { timestamp: true, type: true, direction: true, summary: true },
        })
      : [],
    bundle.eventIds.length
      ? db.event.findMany({
          where: { id: { in: bundle.eventIds }, workspaceId },
          orderBy: { timestamp: "desc" },
          take: MAX_EVENTS,
          select: { timestamp: true, name: true, type: true },
        })
      : [],
    bundle.planIds.length
      ? db.plan.findMany({
          where: { id: { in: bundle.planIds }, workspaceId },
          orderBy: { createdAt: "desc" },
          take: MAX_PLANS,
          select: { createdAt: true, status: true, text: true },
        })
      : [],
    // A rollup, not a history — the latest reading per metric type, matching
    // the Health card's own "latest day's metrics" pattern
    // (apps/persons/server/domain/health.ts), not every historical reading.
    bundle.stateIds.length
      ? db.state.findMany({
          where: { id: { in: bundle.stateIds }, workspaceId },
          orderBy: { recordedAt: "desc" },
          distinct: ["definitionId"],
          select: { recordedAt: true, severity: true, definition: { select: { type: true, value: true, description: true } } },
        })
      : [],
    bundle.evidenceClaimIds.length
      ? db.evidenceClaim.findMany({
          where: { id: { in: bundle.evidenceClaimIds }, workspaceId, status: { notIn: ["dismissed", "superseded", "reversed"] }, sourceFile: { archivedAt: null } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
          include: { sourceFile: { select: { filename: true } }, chunk: { select: { id: true, locator: true } }, subjects: { include: { mention: { select: { sourceText: true, role: true, resolvedPersonId: true } } } } },
        })
      : [],
  ])

  const sections: string[] = []

  if (notes.length) {
    sections.push(formatSection("Notes", notes.map(n =>
      `[${dateTag(n.timestamp)}] (${n.type}) ${truncate(n.content, NOTE_CONTENT_CHARS)}`,
    )))
  }
  if (interactions.length) {
    sections.push(formatSection("Interactions", interactions.map(i =>
      `[${dateTag(i.timestamp)}] ${i.type}${i.direction ? ` (${i.direction})` : ""}: ${i.summary ?? "(no summary)"}`,
    )))
  }
  if (events.length) {
    sections.push(formatSection("Events", events.map(e =>
      `[${dateTag(e.timestamp)}] ${e.type}: ${e.name}`,
    )))
  }
  if (plans.length) {
    sections.push(formatSection("Plans (declared intentions)", plans.map(p =>
      `[created ${dateTag(p.createdAt)}, ${p.status}] ${p.text}`,
    )))
  }
  if (states.length) {
    sections.push(formatSection("Latest tracked readings", states.map(s =>
      `[${dateTag(s.recordedAt)}] ${s.definition.value}${s.definition.description ? ` (${s.definition.description})` : ""}: ${s.severity ?? "n/a"}`,
    )))
  }
  if (fileClaims.length) {
    sections.push(formatSection("Cited file evidence", fileClaims.map(claim => {
      const label = claim.classification === "explicit" ? "EXPLICIT — eligible for Observed" : "INFERRED — Inferred/Hypotheses only"
      const participants = claim.subjects.map(subject => `${subject.mention.sourceText} (${subject.subjectRole})`).join(", ")
      // Weight is per-subject: a claim about several people carries a different
      // relevance for each. Score only this person's subject rows, or a
      // co-subject's higher weight would be presented as if it were theirs.
      const direct = claim.subjects.filter(subject => subject.mention.resolvedPersonId === bundle.person?.id)
      const weight = Math.max(...direct.map(subject => subject.relevanceWeight), 0)
      return `[${label}; review=${claim.status}; weight=${weight.toFixed(2)}] ${claim.assertion}\n  Participants: ${participants}\n  Citation: ${claim.sourceFile.filename} [chunk:${claim.chunk.id}] ${claim.chunk.locator}\n  Exact source: “${claim.exactQuote}”`
    })))
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
