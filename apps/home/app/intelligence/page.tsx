import { Suspense } from "react"
import {
  getCurrentLifeModelSnapshot,
  listLifeModelSnapshots,
  synthesizeLifeModel,
  type LifeModelEvidenceRef,
  type LifeModelClaimInput,
  type LifeModelClaimKind,
} from "@life-os/intelligence"
import { db } from "@life-os/db"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { redirect } from "next/navigation"
import { TheoryRegenerator, type TheoryPersonOption } from "@/components/TheoryRegenerator"
import { ClaimFeedbackControls, LifeModelRegenerator } from "@/components/LifeModelControls"

export const metadata = { title: "Intelligence · Life OS" }

const CLAIM_KINDS: Array<{ kind: LifeModelClaimKind; label: string; description: string }> = [
  { kind: "observed", label: "Observed", description: "Patterns measured directly from the graph." },
  { kind: "inferred", label: "Inferred", description: "Interpretations that must carry confidence and evidence." },
  { kind: "declared", label: "Declared", description: "What you have explicitly said matters or should happen." },
  { kind: "tension", label: "Tension", description: "Where declared intentions and observed behavior diverge." },
]

type DisplayClaim = LifeModelClaimInput & {
  id: string | null
  feedback: { action: string; replacementStatement: string | null } | null
}

export default function IntelligencePage() {
  return <Suspense fallback={<IntelligenceFallback />}><IntelligenceContent /></Suspense>
}

async function IntelligenceContent() {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")

  const [currentSnapshot, snapshots, people] = await Promise.all([
    getCurrentLifeModelSnapshot(workspaceId),
    listLifeModelSnapshots(workspaceId),
    db.person.findMany({
      where: { workspaceId },
      orderBy: [{ closeness: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: 50,
      select: {
        id: true,
        first: true,
        last: true,
        nickname: true,
        theorySnapshots: {
          where: { workspaceId, status: "current" },
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, synthesizedAt: true },
        },
      },
    }),
  ])
  // A saved snapshot is authoritative. Only compute the live deterministic
  // preview when no snapshot exists; this also prevents a future model-backed
  // synthesizer from running on every page view.
  const liveSynthesis = currentSnapshot ? null : await synthesizeLifeModel(workspaceId)
  const claims: DisplayClaim[] = currentSnapshot
    ? currentSnapshot.claims.map(claim => ({
        id: claim.id,
        kind: claim.kind as LifeModelClaimKind,
        statement: claim.feedback[0]?.action === "correct" && claim.feedback[0].replacementStatement
          ? claim.feedback[0].replacementStatement
          : claim.statement,
        confidence: claim.confidence,
        subjectType: claim.subjectType,
        subjectId: claim.subjectId,
        windowStart: claim.windowStart,
        windowEnd: claim.windowEnd,
        evidence: decodeEvidence(claim.evidence),
        feedback: claim.feedback[0] ?? null,
      }))
    : (liveSynthesis?.claims ?? []).map(claim => ({ ...claim, id: null, feedback: null }))
  const realClaims = claims
    .filter(claim => !claim.statement.startsWith("Unknown —") && claim.feedback?.action !== "dismiss")
    .sort((a, b) => claimPriority(b) - claimPriority(a))
  const availableKinds = new Set(realClaims.map(claim => claim.kind))

  return (
    <main className="stream-page">
      <div className="stream-container">
        <p className="still-eyebrow">A reading of your whole life</p>
        <h1 className="stream-heading-title">Intelligence</h1>
        <p className="stream-intro intelligence-intro">
          Derived interpretation across the graph. Every claim says what kind of knowledge it is, why it appears, and which evidence supports it.
        </p>

        <section className="intelligence-reading" aria-labelledby="reading-heading">
          <div>
            <span className="intelligence-reading-mark" aria-hidden>◇</span>
            <p className="still-eyebrow">Current reading</p>
            <h2 id="reading-heading">{readingTitle(realClaims.length)}</h2>
            <p>{currentSnapshot?.summary || readingSummary(realClaims.length)}</p>
          </div>
          <div className="intelligence-freshness">
            <span>Freshness</span>
            <strong>{currentSnapshot ? `Snapshot v${currentSnapshot.version}` : "Live preview"}</strong>
            <small>{currentSnapshot ? formatDate(currentSnapshot.synthesizedAt) : "Computed now from current records"}</small>
          </div>
        </section>
        <LifeModelRegenerator hasSnapshot={Boolean(currentSnapshot)} />

        <section className="intelligence-section" aria-labelledby="claim-kinds-heading">
          <div className="automation-section-heading">
            <div><p className="still-eyebrow">Epistemic labels</p><h2 id="claim-kinds-heading">What kind of truth is this?</h2></div>
            <span className="automation-caption">Interpretation never becomes a primitive</span>
          </div>
          <div className="intelligence-kind-grid">
            {CLAIM_KINDS.map(item => (
              <article className={`intelligence-kind intelligence-kind-${item.kind}`} key={item.kind}>
                <div><span className="intelligence-kind-dot" aria-hidden /><h3>{item.label}</h3></div>
                <p>{item.description}</p>
                <small>{availableKinds.has(item.kind) ? "Available now" : "Awaiting synthesis"}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="intelligence-section" aria-labelledby="insights-heading">
          <div className="automation-section-heading">
            <div><p className="still-eyebrow">Prioritized insights</p><h2 id="insights-heading">What deserves attention</h2></div>
            <span className="stream-count">{realClaims.length} current {realClaims.length === 1 ? "claim" : "claims"}</span>
          </div>
          {realClaims.length === 0
            ? <div className="stream-message">No evidence-backed tensions are visible right now. Observed, inferred, and declared synthesis has not run yet.</div>
            : <div className="intelligence-claim-list">{realClaims.map((claim, index) => <ClaimCard claim={claim} rank={index + 1} key={`${claim.kind}-${claim.subjectId || index}`} />)}</div>}
        </section>

        <section className="intelligence-section" aria-labelledby="history-heading">
          <div className="automation-section-heading">
            <div><p className="still-eyebrow">Versioned memory</p><h2 id="history-heading">Snapshot history</h2></div>
            <span className="stream-count">{snapshots.length} saved {snapshots.length === 1 ? "reading" : "readings"}</span>
          </div>
          {snapshots.length === 0
            ? <div className="stream-message intelligence-history-empty"><strong>No persisted reading yet.</strong><span>The live preview remains derived from current graph records. The first evidence-backed synthesis will become version 1.</span></div>
            : <div className="intelligence-history-list">{snapshots.map(snapshot => (
                <article className={snapshot.status === "current" ? "intelligence-history-current" : undefined} key={snapshot.id}>
                  <div><span>v{snapshot.version}</span><strong>{snapshot.status}</strong></div>
                  <p>{snapshot.summary}</p>
                  <div><time dateTime={snapshot.synthesizedAt.toISOString()}>{formatDate(snapshot.synthesizedAt)}</time><span>{snapshot._count.claims} {snapshot._count.claims === 1 ? "claim" : "claims"}</span><span>{snapshot.modelId || "Deterministic"}</span></div>
                </article>
              ))}</div>}
        </section>

        <section className="intelligence-section" aria-labelledby="person-theory-heading">
          <div className="automation-section-heading">
            <div><p className="still-eyebrow">Person-level interpretation</p><h2 id="person-theory-heading">Theory of a person</h2></div>
            <span className="automation-caption">Manual, billed, and versioned</span>
          </div>
          <p className="intelligence-section-intro">Choose someone when you want a fresh evidence-backed model of that relationship. Home sends the command through the canonical Life OS API; it never synthesizes passively on page load.</p>
          <TheoryRegenerator people={people.map(toTheoryPersonOption)} />
        </section>

        <section className="intelligence-section intelligence-boundary" aria-labelledby="boundary-heading">
          <div>
            <p className="still-eyebrow">The boundary</p>
            <h2 id="boundary-heading">Useful, never unquestionable</h2>
          </div>
          <p>These readings are derived and replaceable. The graph remains the source of truth. Corrections become durable Notes that ground later readings; dismissals are retained as feedback without rewriting history.</p>
        </section>
      </div>
    </main>
  )
}

function toTheoryPersonOption(person: {
  id: string
  first: string
  last: string
  nickname: string | null
  theorySnapshots: Array<{ version: number; synthesizedAt: Date }>
}): TheoryPersonOption {
  const snapshot = person.theorySnapshots[0]
  return {
    id: person.id,
    name: person.nickname || [person.first, person.last].filter(Boolean).join(" ") || "Unnamed person",
    version: snapshot?.version ?? null,
    synthesizedAt: snapshot?.synthesizedAt.toISOString() ?? null,
  }
}

function ClaimCard({ claim, rank }: { claim: DisplayClaim; rank: number }) {
  const evidence = claim.evidence
  const severity = claimPriority(claim)
  const confidence = claim.confidence === null ? null : Math.round(claim.confidence * 100)
  const subjectHref = claim.subjectType === "Person" && claim.subjectId
    ? `https://persons.lacollecteur.com/persons/${encodeURIComponent(claim.subjectId)}`
    : null

  return (
    <article className="intelligence-claim-card">
      <div className="intelligence-claim-rank" aria-label={`Priority ${rank}`}>{String(rank).padStart(2, "0")}</div>
      <div className="intelligence-claim-body">
        <div className="intelligence-claim-labels">
          <span className={`intelligence-claim-kind intelligence-claim-kind-${claim.kind}`}>{humanize(claim.kind)}</span>
          {confidence === null ? null : <span>{confidence}% confidence</span>}
          {severity > 0 ? <span>Priority {severity.toFixed(1)}×</span> : null}
        </div>
        <h3>{claim.statement}</h3>
        {claim.feedback?.action === "correct" ? <p className="intelligence-corrected-label">Corrected by you</p> : null}
        <div className="intelligence-why">
          <strong>Why this appears</strong>
          <p>{evidence.length ? describeEvidence(evidence[0]) : "No evidence reference was supplied."}</p>
        </div>
        <div className="intelligence-claim-footer">
          <span>{evidence.length} evidence {evidence.length === 1 ? "reference" : "references"} · computed from current records</span>
          {subjectHref ? <a href={subjectHref}>Open evidence subject ↗</a> : null}
        </div>
        {claim.id ? <ClaimFeedbackControls key={`${claim.id}:${claim.statement}`} claimId={claim.id} statement={claim.statement} /> : null}
      </div>
    </article>
  )
}

function IntelligenceFallback() {
  return <main className="stream-page"><div className="stream-container"><p className="still-eyebrow">A reading of your whole life</p><h1 className="stream-heading-title">Intelligence</h1><div className="stream-message">Reading current evidence…</div></div></main>
}

function claimPriority(claim: LifeModelClaimInput) {
  const detail = claim.evidence[0]?.detail
  return typeof detail?.severity === "number" ? detail.severity : claim.confidence ?? 0
}

function describeEvidence(evidence: LifeModelClaimInput["evidence"][number]) {
  const subject = typeof evidence.detail?.subject === "string" ? evidence.detail.subject : null
  const severity = typeof evidence.detail?.severity === "number" ? evidence.detail.severity : null
  if (subject && severity !== null) return `${subject} crossed its alignment threshold by ${severity.toFixed(1)}×.`
  if (subject) return `${subject} is the referenced graph subject.`
  return `Derived from ${humanize(evidence.sourceType)} evidence.`
}

function readingTitle(count: number) {
  if (count === 0) return "Nothing is pulling sharply out of alignment"
  if (count === 1) return "One tension is worth looking at"
  return `${count} tensions are worth looking at`
}

function readingSummary(count: number) {
  const tensions = count === 0
    ? "No evidence-backed tensions are visible in the current records."
    : `${count} evidence-backed ${count === 1 ? "tension is" : "tensions are"} visible between declared and observed.`
  return `${tensions} Observed, inferred, and declared readings are not available yet.`
}

function decodeEvidence(raw: string | null): LifeModelEvidenceRef[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.flatMap(item => {
      if (!item || typeof item !== "object") return []
      const record = item as Record<string, unknown>
      if (typeof record.sourceType !== "string" || typeof record.sourceId !== "string") return []
      const detail = record.detail && typeof record.detail === "object" && !Array.isArray(record.detail)
        ? record.detail as Record<string, unknown>
        : undefined
      return [{ sourceType: record.sourceType, sourceId: record.sourceId, detail }]
    })
  } catch {
    return []
  }
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value)
}

function humanize(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase())
}
