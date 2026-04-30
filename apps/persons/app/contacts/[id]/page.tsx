"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import {
  Avatar, BackLink, Button, Card, Chip,
  EmptyState, Spinner,
} from "@life-os/ui"
import InteractionCard from "@/components/interactions/InteractionCard"
import EditPersonModal from "@/components/persons/EditPersonModal"
import LogInteractionModal from "@/components/interactions/LogInteractionModal"
import AddPlanModal from "@/components/plans/AddPlanModal"
import {
  relativeTime, closenessLabel, parseTags, parseJsonArray, formatBirthday,
} from "@/lib/utils"
import { enrichWithAttention } from "@/lib/attention"
import type { Person, Interaction, Plan } from "@/types"

type FullPerson = Person & {
  interactions: Interaction[]
  plans: Plan[]
  attentionScore: number
  lastInteractionDate: Date | null
  daysSinceLast: number | null
}

const closenessPercent: Record<number, number> = { 1: 33, 2: 66, 3: 100 }

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
      setPerson(enrichWithAttention(data) as FullPerson)
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
        <Spinner size={20} color="var(--ink-4)" />
      </div>
    )
  }

  if (!person) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
        <EmptyState icon="?" title="Person not found" subtitle="This contact may have been deleted." />
      </div>
    )
  }

  const tags = Array.isArray(person.tags)
    ? person.tags as unknown as string[]
    : parseTags(person.tags as unknown as string)
  const activePlans = person.plans.filter(p => p.status === "active")

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 24px" }}>

      <BackLink label="All Contacts" href="/contacts" style={{ marginBottom: "20px" }} />

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
              margin: "0 0 4px",
              color: "var(--ink)",
            }}>
              {person.first} {person.last}
            </h1>
            {person.headline && (
              <div style={{ fontSize: "12px", color: "var(--ink-3)", marginBottom: "8px" }}>
                {person.headline}
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
            <Stat label="Last contact" value={relativeTime(person.lastInteractionDate)} accent={person.attentionScore >= 1} />
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
          person.company || person.location || person.linkedin || person.twitter || person.website) && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "16px 22px" }}>
            {person.company && <ContactRow icon="○" items={[person.company]} />}
            {person.location && <ContactRow icon="◎" items={[person.location]} />}
            {person.emails.length > 0 && (
              <ContactRow icon="✉" items={person.emails} hrefPrefix="mailto:" />
            )}
            {person.phones.length > 0 && (
              <ContactRow icon="↗" items={person.phones} hrefPrefix="tel:" />
            )}
            {person.birthday && (
              <ContactRow icon="◑" items={[formatBirthday(person.birthday) ?? person.birthday]} />
            )}
            {(person.linkedin || person.twitter || person.website) && (
              <ContactRow
                icon="⊕"
                items={[person.linkedin, person.twitter, person.website].filter(Boolean) as string[]}
                isLinks
              />
            )}
          </div>
        )}
      </Card>

      {/* ── Notes ───────────────────────────────────────────────── */}
      {person.notes && (
        <Card
          title="Notes"
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
        title={`Interaction Log (${person.interactions.length})`}
        headerAction={
          <Button variant="ghost" size="sm" onClick={() => setShowLogInteraction(true)} style={{ borderRadius: "6px", textTransform: "none", letterSpacing: 0 }}>+ Log</Button>
        }
        style={{ borderRadius: "14px", overflow: "hidden" }}
      >
        {person.interactions.length === 0 ? (
          <EmptyState
            icon="○"
            title="No interactions yet"
            subtitle="Log a call, coffee, or message to start tracking this relationship."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[...person.interactions]
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map(ix => <InteractionCard key={ix.id} interaction={ix} />)}
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
