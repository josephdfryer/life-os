import { lifeOsAppUrl } from "@life-os/auth"
import { db } from "@life-os/db"

export default async function BoundedReviewWidget({ workspaceId }: { workspaceId: string }) {
  const [communications, visits, noteSuggestions] = await Promise.all([
    db.stagedInteraction.findMany({
      where: { workspaceId, status: { in: ["pending", "blocked"] }, type: { not: "financial" } },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: 5,
      select: { id: true, source: true, summary: true, contactName: true, matchReason: true },
    }),
    db.importStagedVisit.findMany({
      where: { workspaceId, status: "pending" },
      orderBy: [{ confidence: "desc" }, { startedAt: "desc" }],
      take: 5,
      select: { id: true, importJobId: true, placeName: true, startedAt: true, confidence: true },
    }),
    db.noteSuggestion.findMany({
      where: { workspaceId, status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 5,
      select: { id: true, kind: true, title: true, confidence: true },
    }),
  ])
  const personsUrl = lifeOsAppUrl("persons", "http://localhost:3000")
  const placesUrl = lifeOsAppUrl("places", "http://localhost:3002")
  const rows = [
    ...noteSuggestions.map(item => ({
      key: `note-${item.id}`,
      label: `${item.kind === "plan" ? "Plan" : "Event"} suggestion`,
      title: item.title,
      detail: item.confidence == null ? "Needs your decision" : `${Math.round(item.confidence * 100)}% confidence`,
      href: "/#quick-capture",
      priority: 0,
    })),
    ...communications.map(item => ({
      key: `communication-${item.id}`,
      label: item.source,
      title: item.contactName || item.summary || "Unmatched communication",
      detail: item.matchReason || "Needs a Person match",
      href: `${personsUrl}/inbox`,
      priority: 1,
    })),
    ...visits.map(item => ({
      key: `visit-${item.id}`,
      label: "Place visit",
      title: item.placeName || "Unresolved visit",
      detail: `${item.startedAt.toLocaleDateString()} · ${Math.round(item.confidence * 100)}% confidence`,
      href: `${placesUrl}/places/import/${item.importJobId}/review`,
      priority: 2,
    })),
  ].sort((a, b) => a.priority - b.priority).slice(0, 5)

  return (
    <section style={card}>
      <div className="bounded-review-heading">
        <div><div className="quick-capture-eyebrow">Bounded review</div><h2 style={heading}>Five decisions, maximum</h2></div>
        <span>{rows.length}</span>
      </div>
      {rows.length ? (
        <div className="bounded-review-list">
          {rows.map(row => (
            <a key={row.key} href={row.href}>
              <span>{row.label}</span><strong>{row.title}</strong><small>{row.detail}</small>
            </a>
          ))}
        </div>
      ) : <div className="capture-analysis-status">Nothing needs review.</div>}
    </section>
  )
}

const card: React.CSSProperties = {
  background: "rgba(247, 244, 238, 0.045)",
  border: "1px solid rgba(196, 165, 116, 0.18)",
  borderRadius: "var(--radius-lg)",
  padding: "32px",
}
const heading: React.CSSProperties = { fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 400, margin: 0 }
