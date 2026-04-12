"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import PersonAvatar from "@/components/persons/PersonAvatar"
import InteractionCard from "@/components/interactions/InteractionCard"
import EditPersonModal from "@/components/persons/EditPersonModal"
import LogInteractionModal from "@/components/interactions/LogInteractionModal"
import AddPlanModal from "@/components/plans/AddPlanModal"
import { relativeTime, closenessLabel, closenessWidth, parseTags, parseJsonArray, formatBirthday } from "@/lib/utils"
import { enrichWithAttention } from "@/lib/attention"
import type { Person, Interaction, Plan } from "@/types"

type FullPerson = Person & {
  interactions: Interaction[]
  plans: Plan[]
  attentionScore: number
  lastInteractionDate: Date | null
  daysSinceLast: number | null
}

export default function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [person, setPerson] = useState<FullPerson | null>(null)
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [showLogInteraction, setShowLogInteraction] = useState(false)
  const [showAddPlan, setShowAddPlan] = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/persons/${id}`)
    if (res.ok) {
      const data = await res.json()
      const enriched = enrichWithAttention(data)
      setPerson(enriched as FullPerson)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  async function handleDelete() {
    if (!confirm(`Delete ${person?.first} ${person?.last}? This cannot be undone.`)) return
    await fetch(`/api/persons/${id}`, { method: "DELETE" })
    router.push("/contacts")
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", color: "var(--ink-4)", fontSize: "12px" }}>
        Loading…
      </div>
    )
  }

  if (!person) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", color: "var(--ink-4)", fontSize: "12px" }}>
        Person not found.
      </div>
    )
  }

  const tags = Array.isArray(person.tags) ? person.tags as unknown as string[] : parseTags(person.tags as unknown as string)
  const activePlans = person.plans.filter(p => p.status === "active")

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 24px" }}>
      {/* Back */}
      <a
        href="/contacts"
        style={{ fontSize: "11px", color: "var(--ink-4)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px", marginBottom: "20px" }}
      >
        ← All Contacts
      </a>

      {/* Header */}
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "24px",
        marginBottom: "20px",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "16px", marginBottom: "16px" }}>
          <PersonAvatar
            first={person.first}
            last={person.last}
            color={person.color}
            colorSoft={person.colorSoft}
            size={52}
            fontSize={18}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontFamily: "var(--font-playfair), serif", fontSize: "22px", fontWeight: 600, margin: "0 0 4px", color: "var(--ink)" }}>
              {person.first} {person.last}
            </h1>
            {person.headline && (
              <div style={{ fontSize: "12px", color: "var(--ink-3)", marginBottom: "8px" }}>{person.headline}</div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  background: person.colorSoft ?? "var(--surface2)",
                  color: person.color ?? "var(--ink-2)",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "10px",
                  fontWeight: 500,
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <button
              onClick={() => setShowEdit(true)}
              style={ghostBtnStyle}
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              style={{ ...ghostBtnStyle, color: "var(--accent)" }}
            >
              Delete
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: "24px", padding: "14px 0", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", marginBottom: "14px" }}>
          <Stat label="Last contact" value={relativeTime(person.lastInteractionDate)} accent={person.attentionScore >= 1} />
          <Stat label="Interactions" value={String(person.interactions.length)} />
          <Stat label="Closeness" value={closenessLabel(person.closeness)} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "10px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "5px" }}>Closeness</div>
            <div style={{ width: "100%", height: "4px", background: "var(--surface2)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: closenessWidth(person.closeness), height: "100%", background: person.color ?? "var(--accent)", borderRadius: "2px" }} />
            </div>
          </div>
        </div>

        {/* Contact info */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
          {person.email && <ContactInfo icon="✉" label={person.email} href={`mailto:${person.email}`} />}
          {person.phone && <ContactInfo icon="↗" label={person.phone} href={`tel:${person.phone}`} />}
          {person.birthday && <ContactInfo icon="◎" label={formatBirthday(person.birthday) ?? ""} />}
        </div>
      </div>

      {/* Notes */}
      {person.notes && (
        <Card title="Notes" style={{ marginBottom: "20px" }}>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--ink-2)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {person.notes}
          </p>
        </Card>
      )}

      {/* Plans */}
      <Card
        title="Active Plans"
        action={
          <button onClick={() => setShowAddPlan(true)} style={inlineActionStyle}>+ Plan</button>
        }
        style={{ marginBottom: "20px" }}
      >
        {activePlans.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--ink-4)", padding: "8px 0" }}>No active plans.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {activePlans.map(plan => (
              <div key={plan.id} style={{
                padding: "10px 12px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "7px",
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "12px", color: "var(--ink)", lineHeight: 1.5 }}>{plan.text}</div>
                  {plan.timescale && (
                    <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "3px" }}>{plan.timescale}</div>
                  )}
                  {plan.successSignals && parseJsonArray(plan.successSignals as unknown as string).length > 0 && (
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
                <button
                  onClick={() => handleMarkPlanDone(plan.id)}
                  style={{ ...ghostBtnStyle, fontSize: "10px", padding: "4px 10px" }}
                >
                  Done
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Interaction Log */}
      <Card
        title={`Interaction Log (${person.interactions.length})`}
        action={
          <button onClick={() => setShowLogInteraction(true)} style={inlineActionStyle}>+ Log</button>
        }
      >
        {person.interactions.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--ink-4)", padding: "8px 0" }}>No interactions logged yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[...person.interactions]
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map(ix => (
                <InteractionCard key={ix.id} interaction={ix} />
              ))}
          </div>
        )}
      </Card>

      {showEdit && (
        <EditPersonModal
          person={person}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load() }}
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

function ContactInfo({ icon, label, href }: { icon: string; label: string; href?: string }) {
  const content = (
    <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "var(--ink-2)" }}>
      <span style={{ color: "var(--ink-4)" }}>{icon}</span>
      {label}
    </span>
  )
  if (href) {
    return <a href={href} style={{ textDecoration: "none" }}>{content}</a>
  }
  return content
}

function Card({
  title,
  action,
  children,
  style,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "12px",
      overflow: "hidden",
      ...style,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 18px",
        borderBottom: "1px solid var(--border)",
      }}>
        <h3 style={{ margin: 0, fontSize: "11px", fontWeight: 500, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          {title}
        </h3>
        {action}
      </div>
      <div style={{ padding: "16px 18px" }}>
        {children}
      </div>
    </div>
  )
}

const ghostBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--ink-3)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "11px",
}

const inlineActionStyle: React.CSSProperties = {
  padding: "4px 12px",
  borderRadius: "5px",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--ink-3)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "10px",
}
