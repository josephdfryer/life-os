import Link from "next/link"
import { db } from "@/lib/db"
import { getCurrentTheorySnapshot, listTheorySnapshots } from "@life-os/theory"
import { renderTheoryMarkdown, extractSectionItems } from "@/lib/markdown"
import { requireWorkspaceAccess } from "@/lib/access"
import { cookies } from "next/headers"
import { resolveTimeZone, TZ_COOKIE } from "@life-os/ui"
import RegenerateButton from "./RegenerateButton"
import AddTheoryNote from "./AddTheoryNote"
import { getTheoryEvidenceState } from "@life-os/files"

export const dynamic = "force-dynamic"

export default async function TheoryOfPersonPage({ params }: { params: Promise<{ personId: string }> }) {
  const access = await requireWorkspaceAccess()
  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)
  const { personId } = await params

  const person = await db.person.findFirst({
    where: { id: personId, workspaceId: access.workspaceId },
    select: { id: true, first: true, last: true, nickname: true, headline: true },
  })

  if (!person) {
    return (
      <Shell>
        <Link href="/" style={backLinkStyle}>← All people</Link>
        <div style={cardStyle}>
          <div style={{ fontSize: "13px", color: "var(--ink-3)" }}>Person not found.</div>
        </div>
      </Shell>
    )
  }

  const name = person.nickname || [person.first, person.last].filter(Boolean).join(" ") || "Unknown"
  const [current, versions, evidenceState] = await Promise.all([
    getCurrentTheorySnapshot(personId, access.workspaceId),
    listTheorySnapshots(personId, access.workspaceId),
    getTheoryEvidenceState(personId, access.workspaceId),
  ])

  const openQuestions = current ? extractSectionItems(current.markdownBody, "Open Questions") : []
  const sourceCounts = current ? countSources(current.sources) : []
  const citedSnapshotSources = current ? current.sources.flatMap(source => {
    if (source.sourceType !== "evidence_claim" || !source.citation) return []
    try { return [{ ...source, parsedCitation: JSON.parse(source.citation) as { fileId: string; filename: string; chunkId: string; exactQuote: string } }] }
    catch { return [] }
  }) : []

  return (
    <Shell>
      <Link href="/" style={backLinkStyle}>← All people</Link>

      {/* Person header */}
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{
          fontFamily: "var(--font-display), serif",
          fontSize: "30px",
          fontWeight: 600,
          color: "var(--ink)",
          letterSpacing: "-0.02em",
          margin: "0 0 4px",
        }}>
          Theory of {name}
        </h1>
        {person.headline && (
          <div style={{ fontSize: "12px", color: "var(--ink-4)" }}>{person.headline}</div>
        )}
      </div>

      {/* Guardrail */}
      <div style={{
        background: evidenceState.stale ? "var(--attention-soft)" : "var(--accent-soft)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "10px 14px",
        marginBottom: "20px",
        fontSize: "11px",
        color: "var(--ink-2)",
        fontStyle: "italic",
      }}>
        {evidenceState.stale ? `${evidenceState.newEvidenceCount} new cited evidence item${evidenceState.newEvidenceCount === 1 ? "" : "s"}${evidenceState.invalidationCount ? ` and ${evidenceState.invalidationCount} evidence change${evidenceState.invalidationCount === 1 ? "" : "s"}` : ""} since this theory. Regenerate now or let the nightly refresh incorporate it.` : "This theory is current for the available cited evidence. It remains a model, not truth."}
      </div>

      {evidenceState.evidence.length > 0 && <div style={{ ...cardStyle, padding: "18px 20px", marginBottom: "20px" }}>
        <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-4)", marginBottom: "10px" }}>New evidence since {current ? `v${current.version}` : "the last theory"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>{evidenceState.evidence.map(claim => <div key={claim.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "10px" }}>
          <div style={{ fontSize: "12px", color: "var(--ink-2)" }}>{claim.assertion}</div>
          <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "4px" }}>{claim.classification} · weight {Math.max(...claim.subjects.map(subject => subject.relevanceWeight), 0).toFixed(2)} · {claim.status}</div>
          <a href={`${process.env.NEXT_PUBLIC_ASSISTANT_URL ?? "https://assistant.lacollecteur.com"}/files/${claim.sourceFile.id}?chunkId=${claim.chunk.id}#${claim.chunk.id}`} style={{ fontSize: "10px", color: "var(--accent)" }}>{claim.sourceFile.filename} · exact passage</a>
        </div>)}</div>
      </div>}

      {/* Actions */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "24px" }}>
        <RegenerateButton personId={personId} />
        <AddTheoryNote personId={personId} personName={name} />
      </div>

      {!current ? (
        <div style={cardStyle}>
          <div style={{ fontSize: "13px", color: "var(--ink-3)", marginBottom: "6px" }}>
            No theory has been synthesized yet.
          </div>
          <div style={{ fontSize: "12px", color: "var(--ink-4)" }}>
            Use “Regenerate Theory” to build the first scaffold from {name}’s records in the graph.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px", gap: "24px", alignItems: "start" }}>
          {/* Main column: the theory body */}
          <div style={cardStyle}>
            <div style={{
              display: "flex",
              gap: "16px",
              flexWrap: "wrap",
              paddingBottom: "16px",
              marginBottom: "20px",
              borderBottom: "1px solid var(--border)",
            }}>
              <Stat label="Version" value={`v${current.version}`} />
              <Stat label="Confidence" value={current.confidence == null ? "—" : current.confidence.toFixed(2)} />
              <Stat label="Synthesized" value={formatDate(current.synthesizedAt, tz)} />
              <Stat label="Sources" value={String(current.sources.length)} />
            </div>

            <div
              className="theory-md"
              dangerouslySetInnerHTML={{ __html: renderTheoryMarkdown(current.markdownBody) }}
            />
          </div>

          {/* Sidebar: open questions, evidence trail, versions */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {openQuestions.length > 0 && (
              <Panel title="Open questions">
                <ul style={{ margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {openQuestions.map((q, i) => (
                    <li key={i} style={{ fontSize: "11px", color: "var(--ink-2)", lineHeight: 1.5 }}>{q}</li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel title="Evidence trail">
              {sourceCounts.length === 0 ? (
                <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>No source records.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  {sourceCounts.map(({ type, count }) => (
                    <div key={type} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                      <span style={{ color: "var(--ink-3)", textTransform: "capitalize" }}>{type}</span>
                      <span style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {citedSnapshotSources.length > 0 ? <Panel title="Cited file evidence">
              <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>{citedSnapshotSources.map(source => <div key={source.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
                <div style={{ fontSize: "10px", color: "var(--ink-3)" }}>{source.evidenceClassification} · weight {source.weight?.toFixed(2) ?? "—"} · {source.evidenceStatus}</div>
                <div style={{ fontSize: "10px", color: "var(--ink-2)", margin: "4px 0" }}>&ldquo;{source.parsedCitation.exactQuote}&rdquo;</div>
                <a href={`${process.env.NEXT_PUBLIC_ASSISTANT_URL ?? "https://assistant.lacollecteur.com"}/files/${source.parsedCitation.fileId}?chunkId=${source.parsedCitation.chunkId}#${source.parsedCitation.chunkId}`} style={{ fontSize: "10px", color: "var(--accent)" }}>{source.parsedCitation.filename} · exact passage</a>
              </div>)}</div>
            </Panel> : null}

            <Panel title={`Prior versions (${versions.length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {versions.map(v => (
                  <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "11px" }}>
                    <span style={{ color: v.status === "current" ? "var(--accent)" : "var(--ink-3)" }}>
                      v{v.version} {v.status === "current" ? "· current" : `· ${v.status}`}
                    </span>
                    <span style={{ color: "var(--ink-4)", fontVariantNumeric: "tabular-nums" }}>
                      {v._count.sources} src
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: "1040px", margin: "0 auto", padding: "32px 24px" }}>{children}</div>
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "10px",
      padding: "14px 16px",
    }}>
      <div style={{
        fontSize: "10px",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--ink-4)",
        marginBottom: "10px",
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-4)", marginBottom: "2px" }}>
        {label}
      </div>
      <div style={{ fontSize: "13px", color: "var(--ink)", fontWeight: 500 }}>{value}</div>
    </div>
  )
}

function countSources(sources: { sourceType: string }[]): { type: string; count: number }[] {
  const map = new Map<string, number>()
  for (const s of sources) map.set(s.sourceType, (map.get(s.sourceType) ?? 0) + 1)
  return Array.from(map.entries()).map(([type, count]) => ({ type, count }))
}

function formatDate(d: Date, timeZone?: string): string {
  return new Date(d).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" })
}

const backLinkStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--ink-3)",
  textDecoration: "none",
  display: "inline-block",
  marginBottom: "20px",
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "28px 30px",
}
