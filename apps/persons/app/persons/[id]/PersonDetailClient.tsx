"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Avatar, BackLink, Button, Card, Chip,
  EmptyState, Spinner, StatBlock,
} from "@life-os/ui"
import InteractionCard from "@/components/interactions/InteractionCard"
import EditPersonModal from "@/components/persons/EditPersonModal"
import PublicProfilePanel from "@/components/persons/PublicProfilePanel"
import LogInteractionModal from "@/components/interactions/LogInteractionModal"
import AddPlanModal from "@/components/plans/AddPlanModal"
import RegenerateButton from "@/components/theory/RegenerateButton"
import AddTheoryNote from "@/components/theory/AddTheoryNote"
import {
  relativeTime, closenessLabel, parseTags, parseJsonArray, formatBirthday,
} from "@/lib/utils"
import { enrichWithAttention } from "@/lib/attention"
import { personSourceBadge } from "@/lib/person-list-presentation"
import type { Person, Interaction, Plan, PersonHealthSummary } from "@/types"

type FullPerson = Person & {
  interactions: Interaction[]
  plans: Plan[]
  attentionScore: number
  lastInteractionDate: Date | null
  daysSinceLast: number | null
  health?: PersonHealthSummary | null
  fileEvidence?: FileEvidence[]
}

type FileEvidence = {
  id: string
  assertion: string
  classification: string
  status: string
  exactQuote: string
  confidence: number
  fileId: string
  filename: string
  chunkId: string
  locator: string
  inCurrentTheory: boolean
  subjects: Array<{ mentionId: string; role: string; sourceText: string; resolutionConfidence: number; relevanceWeight: number }>
}

const closenessPercent: Record<number, number> = { 1: 25, 2: 50, 3: 75, 4: 100 }

export type PersonTheorySummary = {
  version: number | null
  confidence: number | null
  synthesizedAt: string | null
  stale: boolean
  newEvidenceCount: number
  invalidationCount: number
  notes: { id: string; content: string; timestamp: string; type: string }[]
}

type InitialData = Omit<FullPerson, "attentionScore" | "lastInteractionDate" | "daysSinceLast">

export default function PersonDetailClient({
  id,
  initialData,
  theory,
}: {
  id: string
  initialData: InitialData | null
  theory?: PersonTheorySummary | null
}) {
  const router = useRouter()
  const [person, setPerson] = useState<FullPerson | null>(
    () => initialData ? enrichWithAttention(initialData as never) as FullPerson : null
  )
  const [loading, setLoading] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showLogInteraction, setShowLogInteraction] = useState(false)
  const [showAddPlan, setShowAddPlan] = useState(false)
  const [showHealthLog, setShowHealthLog] = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/persons/${id}`)
    if (res.ok) {
      const data = await res.json()
      setPerson(enrichWithAttention(data) as FullPerson)
    }
    setLoading(false)
  }

  async function handleDelete() {
    if (!confirm(`Delete ${person?.first} ${person?.last}? This cannot be undone.`)) return
    await fetch(`/api/persons/${id}`, { method: "DELETE" })
    router.push("/persons")
  }

  async function handleMarkPlanDone(planId: string) {
    await fetch(`/api/plans/${planId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "complete" }),
    })
    load()
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
        <Spinner size={20} color="var(--ink-4)" />
      </div>
    )
  }

  if (!person) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
        <EmptyState icon="?" title="Person not found" subtitle="This person may have been deleted." />
      </div>
    )
  }

  const tags = Array.isArray(person.tags)
    ? person.tags as unknown as string[]
    : parseTags(person.tags as unknown as string)
  const activePlans = person.plans.filter(p => p.status === "active")
  const communications = person.interactions.filter(ix => ix.type === "message" || ix.type === "email")
  const calendarEvents = person.interactions.filter(ix => ix.type === "calendar")
  const relationshipHistory = person.interactions.filter(ix => !["message", "email", "calendar"].includes(ix.type))

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 24px" }}>

      <BackLink label="All Persons" href="/persons" component={Link} style={{ marginBottom: "20px" }} />

      {/* ── Header card ─────────────────────────────────────────── */}
      <Card style={{ borderRadius: "14px", marginBottom: "20px", overflow: "hidden" }}>

        {/* Name row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "16px", padding: "22px 22px 0" }}>
          <Avatar
            name={`${person.first} ${person.last}`}
            size="lg"
            color={person.colorSoft ?? undefined}
            textColor={person.color ?? undefined}
            style={{ borderRadius: "50%", border: `1.5px solid ${person.color ?? "var(--border)"}22` }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{
              fontFamily: "var(--font-display)",
              fontSize: "22px",
              fontWeight: 600,
              margin: "0 0 2px",
              color: "var(--ink)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}>
              {person.first} {person.last}
              {(() => {
                const badge = personSourceBadge(person.source)
                return badge ? (
                  <span
                    title={badge.label}
                    aria-label={badge.label}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: "20px", height: "20px", borderRadius: "50%",
                      background: "var(--surface2)", color: "var(--ink-4)",
                      fontSize: "11px", flexShrink: 0,
                    }}
                  >
                    {badge.icon}
                  </span>
                ) : null
              })()}
            </h1>
            {person.nickname && (
              <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "4px" }}>
                aka {person.nickname}
              </div>
            )}
            {(person.title || person.headline) && (
              <div style={{ fontSize: "12px", color: "var(--ink-3)", marginBottom: "8px" }}>
                {person.title ?? person.headline}
                {person.title && person.company ? ` at ${person.company}` : ""}
              </div>
            )}
            {tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                {tags.map(tag => (
                  <Chip
                    key={tag}
                    label={tag}
                    style={{
                      background: person.colorSoft ?? "var(--surface2)",
                      color: person.color ?? "var(--ink-2)",
                      border: "none",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <Button variant="ghost" size="sm" onClick={() => setShowEdit(true)} style={{ borderRadius: "6px", textTransform: "none", letterSpacing: 0 }}>Edit</Button>
            <Button variant="danger" size="sm" onClick={handleDelete} style={{ borderRadius: "6px", textTransform: "none", letterSpacing: 0 }}>Delete</Button>
          </div>
        </div>

        {/* Stats row */}
        <div style={{
          display: "flex",
          gap: "0",
          padding: "16px 22px",
          marginTop: "18px",
          borderTop: "1px solid var(--separator)",
          borderBottom: "1px solid var(--separator)",
          alignItems: "center",
        }}>
          <div style={{ display: "flex", gap: "28px", flex: 1 }}>
            <Stat label="Last touch" value={relativeTime(person.lastInteractionDate)} accent={person.attentionScore >= 1} />
            <Stat label="Interactions" value={String(person.interactions.length)} />
            <Stat label="Closeness" value={closenessLabel(person.closeness)} />
          </div>
          <div style={{ width: "120px", flexShrink: 0 }}>
            <div style={{ width: "100%", height: "4px", background: "var(--surface2)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: `${closenessPercent[person.closeness] ?? 0}%`, height: "100%", background: person.color ?? "var(--accent)", borderRadius: "2px" }} />
            </div>
          </div>
        </div>

        {/* Contact info */}
        {(person.emails.length > 0 || person.phones.length > 0 || person.birthday ||
          person.title || person.company || person.location || person.linkedin || person.twitter || person.website || person.facebook || person.instagram) && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "16px 22px" }}>
            {person.title && <ContactRow icon="◌" items={[person.title]} />}
            {person.company && <ContactRow icon="○" items={[person.company]} />}
            {person.location && <ContactRow icon="◎" items={[person.location]} />}
            {person.emails.length > 0 && (
              <ContactRow icon="✉" items={person.emails} hrefPrefix="mailto:" />
            )}
            {person.emails.length > 0 && <SuperhumanRow emails={person.emails} />}
            {person.phones.length > 0 && (
              <ContactRow icon="↗" items={person.phones} hrefPrefix="tel:" />
            )}
            {person.birthday && (
              <ContactRow icon="◑" items={[formatBirthday(person.birthday) ?? person.birthday]} />
            )}
            {(person.linkedin || person.twitter || person.website || person.facebook || person.instagram) && (
              <ContactRow
                icon="⊕"
                items={[person.linkedin, person.twitter, person.website, person.facebook, person.instagram].filter(Boolean) as string[]}
                isLinks
              />
            )}
          </div>
        )}
      </Card>

      <PublicProfilePanel personId={person.id} />

      {theory && (
        <Card
          title="Theory"
          headerAction={
            <Link href={`/persons/${person.id}/theory`} style={{ fontSize: "11px", color: "var(--cognac-deep)", textDecoration: "none" }}>
              Open
            </Link>
          }
          style={{ borderRadius: "14px", marginBottom: "20px", overflow: "hidden" }}
        >
          {theory.stale && (
            <div style={{
              fontSize: "11px",
              color: "var(--ink-2)",
              fontStyle: "italic",
              background: "var(--attention-soft)",
              borderRadius: "8px",
              padding: "8px 10px",
              marginBottom: "12px",
            }}>
              {theory.newEvidenceCount} new cited evidence item{theory.newEvidenceCount === 1 ? "" : "s"}
              {theory.invalidationCount ? ` and ${theory.invalidationCount} evidence change${theory.invalidationCount === 1 ? "" : "s"}` : ""} since this theory.
            </div>
          )}
          {theory.version == null ? (
            <EmptyState icon="◎" title="No theory yet" subtitle="Synthesize a living model from this person's graph." />
          ) : (
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: theory.notes.length ? "12px" : 0 }}>
              <StatBlock label="Version" value={`v${theory.version}`} style={{ borderRadius: "8px" }} />
              <StatBlock label="Confidence" value={theory.confidence == null ? "—" : theory.confidence.toFixed(2)} style={{ borderRadius: "8px" }} />
              <StatBlock
                label="Synthesized"
                value={theory.synthesizedAt ? relativeTime(new Date(theory.synthesizedAt)) : "—"}
                style={{ borderRadius: "8px" }}
              />
            </div>
          )}
          {theory.notes.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0" }}>
              {theory.notes.map(note => (
                <div key={note.id} style={{
                  padding: "10px 12px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                }}>
                  <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "4px" }}>
                    {note.type.replaceAll("_", " ")} · {relativeTime(new Date(note.timestamp))}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--ink-2)", lineHeight: 1.55 }}>{note.content}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
            <RegenerateButton personId={person.id} />
            <AddTheoryNote personId={person.id} personName={[person.first, person.last].filter(Boolean).join(" ") || "this person"} />
          </div>
        </Card>
      )}

      <Card title={`File evidence (${person.fileEvidence?.length ?? 0})`} style={{ borderRadius: "14px", marginBottom: "20px", overflow: "hidden" }}>
        {!person.fileEvidence?.length ? <EmptyState icon="▧" title="No file evidence" subtitle="Resolved, relevant evidence from private files will appear here." /> : <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {person.fileEvidence.map(claim => <article key={claim.id} style={{ padding: "12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "10px" }}>
            <div style={{ fontSize: "12px", color: "var(--ink)", lineHeight: 1.5 }}>{claim.assertion}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px", color: "var(--ink-4)", fontSize: "10px" }}><span>{claim.classification}</span><span>·</span><span>{claim.status}</span><span>·</span><span>weight {Math.max(...claim.subjects.map(subject => subject.relevanceWeight)).toFixed(2)}</span><span>·</span><span>{claim.subjects.map(subject => subject.role).join(", ")}</span><span>·</span><span>{Math.round(Math.max(...claim.subjects.map(subject => subject.resolutionConfidence)) * 100)}% identity confidence</span><span>·</span><span>{claim.inCurrentTheory ? "in current Theory" : "not yet in current Theory"}</span></div>
            <blockquote style={{ margin: "8px 0", paddingLeft: "10px", borderLeft: "2px solid var(--cognac-soft)", color: "var(--ink-3)", fontSize: "11px" }}>&ldquo;{claim.exactQuote}&rdquo;</blockquote>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <a href={`${process.env.NEXT_PUBLIC_ASSISTANT_URL ?? "https://assistant.lacollecteur.com"}/files/${claim.fileId}?chunkId=${claim.chunkId}#${claim.chunkId}`} style={{ color: "var(--cognac-deep)", fontSize: "10px" }}>{claim.filename} · exact passage</a>
              <button onClick={async () => { const response = await fetch(`/api/file-mentions/${claim.subjects[0]?.mentionId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "not_this_person" }) }); if (response.ok) window.location.reload() }} style={{ border: 0, background: "transparent", color: "var(--ink-4)", textDecoration: "underline", fontSize: "10px", cursor: "pointer" }}>Not actually this person</button>
            </div>
          </article>)}
        </div>}
      </Card>

      {/* ── Health ──────────────────────────────────────────────── */}
      {person.health && (
        <Card
          title="Health"
          headerAction={
            <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>
              latest {relativeTime(new Date(person.health.latestDate))}
            </span>
          }
          style={{ borderRadius: "14px", marginBottom: "20px", overflow: "hidden" }}
        >
          {person.health.metrics.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "8px", marginBottom: "12px" }}>
              {person.health.metrics.map(metric => (
                <StatBlock
                  key={metric.key}
                  label={metric.label}
                  value={`${Math.round(metric.value * 10) / 10}${metric.unit ? ` ${metric.unit}` : ""}`}
                  style={{ borderRadius: "8px" }}
                />
              ))}
            </div>
          )}
          <button
            onClick={() => setShowHealthLog(v => !v)}
            style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              fontSize: "11px", color: "var(--ink-4)", textDecoration: "underline",
            }}
          >
            {showHealthLog ? "Hide" : "Show"} daily log ({person.health.totalReadings} readings tracked)
          </button>
          {showHealthLog && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
              {person.health.recentLog.map(entry => (
                <div key={entry.id} style={{
                  padding: "10px 12px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                }}>
                  <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "4px" }}>
                    {new Date(entry.date).toLocaleDateString(undefined, { timeZone: "UTC" })}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--ink-2)", lineHeight: 1.6 }}>{entry.content}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Notes ───────────────────────────────────────────────── */}
      {person.notes && (
        <Card
          title="Profile notes"
          style={{ borderRadius: "14px", marginBottom: "20px", overflow: "hidden" }}
        >
          <p style={{ margin: 0, fontSize: "12px", color: "var(--ink-2)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {person.notes}
          </p>
        </Card>
      )}

      {/* ── Active Plans ─────────────────────────────────────────── */}
      <Card
        title="Active Plans"
        headerAction={
          <Button variant="ghost" size="sm" onClick={() => setShowAddPlan(true)} style={{ borderRadius: "6px", textTransform: "none", letterSpacing: 0 }}>+ Plan</Button>
        }
        style={{ borderRadius: "14px", marginBottom: "20px", overflow: "hidden" }}
      >
        {activePlans.length === 0 ? (
          <EmptyState
            icon="◇"
            title="No active plans"
            subtitle="Add a plan to track what you want to do with this person."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {activePlans.map(plan => (
              <div key={plan.id} style={{
                padding: "10px 12px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "12px", color: "var(--ink)", lineHeight: 1.5 }}>{plan.text}</div>
                  {plan.timescale && (
                    <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "3px" }}>
                      {plan.timescale}
                    </div>
                  )}
                  {plan.successSignals &&
                    parseJsonArray(plan.successSignals as unknown as string).length > 0 && (
                    <div style={{ marginTop: "6px" }}>
                      {parseJsonArray(plan.successSignals as unknown as string).map((s, i) => (
                        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "2px" }}>
                          <span style={{ color: "var(--ink-4)", fontSize: "10px" }}>→</span>
                          <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>{s}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleMarkPlanDone(plan.id)}
                  style={{ borderRadius: "6px", textTransform: "none", letterSpacing: 0 }}
                >
                  Done
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Interaction Log ──────────────────────────────────────── */}
      <Card
        title={`Communications (${communications.length})`}
        headerAction={
          <Button variant="ghost" size="sm" onClick={() => setShowLogInteraction(true)} style={{ borderRadius: "6px", textTransform: "none", letterSpacing: 0 }}>+ Log</Button>
        }
        style={{ borderRadius: "14px", overflow: "hidden" }}
      >
        {communications.length === 0 ? (
          <EmptyState
            icon="○"
            title="No communications yet"
            subtitle="Email, iMessage, and WhatsApp conversations will appear here."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[...communications]
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map(ix => <InteractionCard key={ix.id} interaction={ix} onDelete={load} />)}
          </div>
        )}
      </Card>

      {relationshipHistory.length > 0 && (
        <Card title={`Relationship history (${relationshipHistory.length})`} style={{ borderRadius: "14px", overflow: "hidden", marginTop: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[...relationshipHistory].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map(ix => (
              <InteractionCard key={ix.id} interaction={ix} onDelete={load} />
            ))}
          </div>
        </Card>
      )}

      {calendarEvents.length > 0 && (
        <details style={{ marginTop: "20px" }}>
          <summary style={{ cursor: "pointer", color: "var(--ink-3)", fontSize: "12px" }}>
            Calendar events ({calendarEvents.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
            {[...calendarEvents].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map(ix => (
              <InteractionCard key={ix.id} interaction={ix} onDelete={load} />
            ))}
          </div>
        </details>
      )}

      {showEdit && (
        <EditPersonModal
          person={person}
          onClose={() => setShowEdit(false)}
          onSaved={(keptId) => {
            setShowEdit(false)
            if (keptId && keptId !== id) {
              router.replace(`/persons/${keptId}`)
            } else {
              load()
            }
          }}
        />
      )}
      {showLogInteraction && (
        <LogInteractionModal
          personId={person.id}
          personName={`${person.first} ${person.last}`}
          onClose={() => setShowLogInteraction(false)}
          onSaved={() => { setShowLogInteraction(false); load() }}
        />
      )}
      {showAddPlan && (
        <AddPlanModal
          personId={person.id}
          personName={`${person.first} ${person.last}`}
          onClose={() => setShowAddPlan(false)}
          onSaved={() => { setShowAddPlan(false); load() }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "10px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "3px" }}>{label}</div>
      <div style={{ fontSize: "13px", fontWeight: 500, color: accent ? "var(--accent)" : "var(--ink)" }}>{value}</div>
    </div>
  )
}

// Opens Superhuman's web app pre-searched for the address, showing all
// correspondence with this person. (The desktop app picks these links up
// when installed.)
function SuperhumanRow({ emails }: { emails: string[] }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
      <span style={{
        fontSize: "12px", color: "var(--ink-4)", width: "16px",
        textAlign: "center", flexShrink: 0, paddingTop: "4px",
      }}>
        ⚡
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {emails.map(email => (
          <a
            key={email}
            href={`https://mail.superhuman.com/search/${encodeURIComponent(email)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none" }}
          >
            <Chip
              label={emails.length > 1 ? `Superhuman · ${email}` : "Open in Superhuman"}
              variant="accent"
              style={{ wordBreak: "break-all" }}
            />
          </a>
        ))}
      </div>
    </div>
  )
}

function ContactRow({
  icon, items, hrefPrefix, isLinks,
}: {
  icon: string
  items: string[]
  hrefPrefix?: string
  isLinks?: boolean
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
      <span style={{
        fontSize: "12px", color: "var(--ink-4)", width: "16px",
        textAlign: "center", flexShrink: 0, paddingTop: "4px",
      }}>
        {icon}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {items.map((item, i) => {
          const href = isLinks ? item : hrefPrefix ? `${hrefPrefix}${item}` : undefined
          const chip = (
            <Chip
              key={i}
              label={item}
              variant={href ? "accent" : "default"}
              style={{ wordBreak: "break-all" }}
            />
          )
          return href
            ? (
              <a
                key={i}
                href={href}
                target={isLinks ? "_blank" : undefined}
                rel={isLinks ? "noopener noreferrer" : undefined}
                style={{ textDecoration: "none" }}
              >
                {chip}
              </a>
            )
            : chip
        })}
      </div>
    </div>
  )
}
