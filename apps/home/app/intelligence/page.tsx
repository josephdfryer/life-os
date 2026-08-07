import { Suspense } from "react"
import {
  synthesizeLifeModel,
  type LifeModelClaimInput,
  type LifeModelClaimKind,
} from "@life-os/intelligence"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { redirect } from "next/navigation"

export const metadata = { title: "Intelligence · Life OS" }

const CLAIM_KINDS: Array<{ kind: LifeModelClaimKind; label: string; description: string }> = [
  { kind: "observed", label: "Observed", description: "Patterns measured directly from the graph." },
  { kind: "inferred", label: "Inferred", description: "Interpretations that must carry confidence and evidence." },
  { kind: "declared", label: "Declared", description: "What you have explicitly said matters or should happen." },
  { kind: "tension", label: "Tension", description: "Where declared intentions and observed behavior diverge." },
]

export default function IntelligencePage() {
  return <Suspense fallback={<IntelligenceFallback />}><IntelligenceContent /></Suspense>
}

async function IntelligenceContent() {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")

  // This computes from existing primitives and does not touch the new A6
  // snapshot tables. It remains production-safe until that migration lands;
  // persisted history can layer onto this exact view afterward.
  const { claims } = await synthesizeLifeModel(workspaceId)
  const realClaims = claims
    .filter(claim => !claim.statement.startsWith("Unknown —"))
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
            <p>{readingSummary(realClaims.length)}</p>
          </div>
          <div className="intelligence-freshness">
            <span>Freshness</span>
            <strong>Computed now</strong>
            <small>From current graph records</small>
          </div>
        </section>

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

        <section className="intelligence-section intelligence-boundary" aria-labelledby="boundary-heading">
          <div>
            <p className="still-eyebrow">The boundary</p>
            <h2 id="boundary-heading">Useful, never unquestionable</h2>
          </div>
          <p>These readings are derived and replaceable. The graph remains the source of truth. Correction and dismissal will become durable feedback once the shared intelligence commands are available.</p>
        </section>
      </div>
    </main>
  )
}

function ClaimCard({ claim, rank }: { claim: LifeModelClaimInput; rank: number }) {
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
        <div className="intelligence-why">
          <strong>Why this appears</strong>
          <p>{evidence.length ? describeEvidence(evidence[0]) : "No evidence reference was supplied."}</p>
        </div>
        <div className="intelligence-claim-footer">
          <span>{evidence.length} evidence {evidence.length === 1 ? "reference" : "references"} · computed from current records</span>
          {subjectHref ? <a href={subjectHref}>Open evidence subject ↗</a> : null}
        </div>
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

function humanize(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase())
}
