import { db } from "@/lib/db"
import { requireWorkspaceAccess } from "@/lib/access"
import FileActions from "./FileActions"
import { ClaimReviewControls, MentionReviewControls } from "./EvidenceReviewControls"

export const dynamic = "force-dynamic"

export default async function FileDetailPage({ params, searchParams }: { params: Promise<{ fileId: string }>; searchParams: Promise<{ chunkCursor?: string; chunkId?: string }> }) {
  const access = await requireWorkspaceAccess()
  const { fileId } = await params
  const { chunkCursor, chunkId } = await searchParams
  const latestChunk = await db.fileChunk.aggregate({ where: { sourceFileId: fileId, workspaceId: access.workspaceId }, _max: { version: true } })
  const file = await db.importedFile.findFirst({ where: { id: fileId, workspaceId: access.workspaceId }, include: {
    processingRuns: { orderBy: { createdAt: "desc" }, take: 5 },
    chunks: chunkId
      ? { where: { id: chunkId }, orderBy: [{ version: "desc" }, { ordinal: "asc" }] }
      : { where: { version: latestChunk._max.version ?? 0 }, orderBy: [{ ordinal: "asc" }, { id: "asc" }], take: 101, ...(chunkCursor ? { cursor: { id: chunkCursor }, skip: 1 } : {}) },
    entityMentions: { orderBy: { createdAt: "asc" }, include: { resolvedPerson: { select: { id: true, first: true, last: true } } } },
    evidenceClaims: { orderBy: { createdAt: "asc" }, include: { chunk: { select: { id: true, locator: true } }, subjects: { include: { mention: { include: { resolvedPerson: { select: { id: true, first: true, last: true } } } } } } } },
  } })
  if (!file) return <main style={{ padding: 32 }}>File not found.</main>
  const people = file.entityMentions.filter(m => m.entityType === "Person")
  const hasMoreChunks = !chunkId && file.chunks.length > 100
  const chunks = hasMoreChunks ? file.chunks.slice(0, 100) : file.chunks
  return <main style={{ maxWidth: "1000px", margin: "0 auto", padding: "32px 24px" }}>
    <a href="/files" style={{ color: "var(--ink-3)", fontSize: "12px" }}>← Files</a>
    <header style={{ margin: "18px 0 24px" }}><h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, margin: 0 }}>{file.filename}</h1><div style={{ color: "var(--ink-3)", fontSize: "12px", marginTop: 6 }}>{file.processingState} · {file.mimeType} · {file.sizeBytes.toLocaleString()} bytes</div></header>
    <FileActions fileId={file.id} archived={!!file.archivedAt} />
    <section style={sectionStyle}><h2 style={headingStyle}>Connected people</h2>{people.length ? people.map(person => <div key={person.id} style={{ ...rowStyle, display: "block" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>{person.sourceText} · {person.role}</span><span style={{ color: "var(--ink-3)" }}>{person.resolvedPerson ? `${person.resolvedPerson.first} ${person.resolvedPerson.last}` : person.resolutionStatus} · {(person.confidence * 100).toFixed(0)}%</span></div><MentionReviewControls mentionId={person.id} currentName={person.resolvedPerson ? `${person.resolvedPerson.first} ${person.resolvedPerson.last}` : undefined} /></div>) : <Empty />}</section>
    <section style={sectionStyle}><h2 style={headingStyle}>Claims</h2>{file.evidenceClaims.length ? file.evidenceClaims.map(claim => <article key={claim.id} style={{ ...rowStyle, display: "block" }}><div>{claim.assertion}</div><div style={{ color: "var(--ink-3)", fontSize: "11px", marginTop: 6 }}>{claim.classification} · {claim.status} · {claim.subjects.map(subject => subject.mention.resolvedPerson ? `${subject.mention.resolvedPerson.first} ${subject.mention.resolvedPerson.last}` : subject.mention.sourceText).join(", ")}</div><blockquote style={{ margin: "8px 0 0", color: "var(--ink-2)", fontSize: "12px" }}>&ldquo;{claim.exactQuote}&rdquo; <a href={`/files/${file.id}?chunkId=${claim.chunk.id}#${claim.chunk.id}`}>citation</a></blockquote><ClaimReviewControls claimId={claim.id} status={claim.status} assertion={claim.assertion} canUndo={!!claim.graphResultId} /></article>) : <Empty />}</section>
    <section style={sectionStyle}><h2 style={headingStyle}>Source passages</h2>{chunkId ? <a href={`/files/${file.id}`} style={{ color: "var(--ink-3)", fontSize: 11 }}>Show all passages</a> : null}{chunks.map(chunk => <article id={chunk.id} key={chunk.id} style={{ ...rowStyle, display: "block", scrollMarginTop: 80 }}><div style={{ color: "var(--ink-4)", fontSize: "10px", marginBottom: 6 }}>{chunk.id} · {chunk.locatorType} {chunk.locator}</div><div style={{ whiteSpace: "pre-wrap", fontSize: "12px", lineHeight: 1.6 }}>{chunk.content}</div></article>)}{hasMoreChunks ? <a href={`/files/${file.id}?chunkCursor=${chunks.at(-1)?.id ?? ""}`} style={{ display: "inline-block", marginTop: 12, color: "var(--cognac-deep)", fontSize: 12 }}>Next passages →</a> : null}</section>
  </main>
}

function Empty() { return <div style={{ color: "var(--ink-4)", fontSize: 12 }}>Nothing extracted yet.</div> }
const sectionStyle: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)", padding: "20px", marginTop: "18px" }
const headingStyle: React.CSSProperties = { fontSize: "11px", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-4)", margin: "0 0 12px" }
const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: "14px", borderTop: "1px solid var(--border-subtle)", padding: "12px 0", fontSize: "12px" }
