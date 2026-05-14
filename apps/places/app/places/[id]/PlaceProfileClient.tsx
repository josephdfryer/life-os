"use client"

import { useState } from "react"
import Link from "next/link"
import { BackLink, Button, Card, EmptyState } from "@life-os/ui"

type PlaceNote = {
  id: string
  placeId: string
  workspaceId: string
  body: string
  eventId: string | null
  createdAt: string
  updatedAt: string
}

type PlaceProfile = {
  place: {
    id: string
    name: string
    type: string | null
    address: string | null
    meaning: string | null
    favorite: boolean
  }
  stats: {
    visitCount: number
    photoCount: number
    personCount: number
    groupCount: number
    noteCount: number
    planCount: number
    firstVisitAt?: string
    lastVisitAt?: string
    totalSpend?: number
  }
  timeline: {
    eventId: string
    title: string
    startedAt: string
    people: { id: string; name: string }[]
    groups: { id: string; name: string; associationType: "explicit_tag" | "inferred" | "place_affiliation" }[]
    photoCount: number
    spendAmount?: number
    notePreview?: string
  }[]
  people: { personId: string; name: string; sharedEventCount: number; lastSharedEventAt?: string }[]
  groups: {
    affiliated: { groupId: string; name: string; groupType: string; relationshipType?: string }[]
    activity: { groupId: string; name: string; groupType: string; eventCount?: number }[]
  }
  photos: { itemId: string; name: string; eventId: string; eventTitle: string; occurredAt: string }[]
  notes: PlaceNote[]
  plans: { planId: string; title: string; plannedDate?: string }[]
}

export default function PlaceProfileClient({ initialProfile }: { initialProfile: PlaceProfile | null }) {
  const [profile, setProfile] = useState(initialProfile)
  const [noteBody, setNoteBody] = useState("")
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState("")
  const [saving, setSaving] = useState(false)

  if (!profile) {
    return (
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "32px 24px" }}>
        <BackLink label="All Places" href="/places" component={Link} style={{ marginBottom: "20px" }} />
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }}>
          <EmptyState icon="?" title="Place not found" subtitle="This place may have been deleted." />
        </div>
      </div>
    )
  }

  async function reload() {
    if (!profile) return
    const res = await fetch(`/api/places/${profile.place.id}/profile`)
    if (res.ok) setProfile(await res.json())
  }

  async function toggleFavorite() {
    if (!profile) return
    const res = await fetch(`/api/places/${profile.place.id}/favorite`, { method: "POST" })
    if (res.ok) {
      const place = await res.json()
      setProfile({ ...profile, place: { ...profile.place, favorite: place.favorite } })
    }
  }

  async function addNote() {
    if (!profile || !noteBody.trim()) return
    setSaving(true)
    await fetch(`/api/places/${profile.place.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: noteBody }),
    })
    setNoteBody("")
    await reload()
    setSaving(false)
  }

  async function saveNote(noteId: string) {
    if (!profile || !editingBody.trim()) return
    setSaving(true)
    await fetch(`/api/places/${profile.place.id}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editingBody }),
    })
    setEditingNoteId(null)
    setEditingBody("")
    await reload()
    setSaving(false)
  }

  async function deleteNote(noteId: string) {
    if (!profile || !confirm("Delete this place note?")) return
    setSaving(true)
    await fetch(`/api/places/${profile.place.id}/notes/${noteId}`, { method: "DELETE" })
    await reload()
    setSaving(false)
  }

  const summary = deterministicSummary(profile)
  const memorySignal = primaryMemorySignal(profile)

  return (
    <div style={{ maxWidth: "1040px", margin: "0 auto", padding: "32px 24px 48px" }}>
      <BackLink label="All Places" href="/places" component={Link} style={{ marginBottom: "20px" }} />

      <header style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden", marginBottom: "18px" }}>
        <div style={{ minHeight: "230px", background: "linear-gradient(135deg, #ded7ca 0%, #b8c4bd 58%, #9ea99f 100%)", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(26,24,20,0.05), rgba(26,24,20,0.32))" }} />
          <div style={{ position: "absolute", left: "24px", right: "72px", bottom: "22px", color: "#fff", textShadow: "0 1px 16px rgba(0,0,0,0.32)" }}>
            <div style={{ fontSize: "11px", opacity: 0.82, marginBottom: "6px" }}>
              {[profile.place.type, formatDate(profile.stats.lastVisitAt) !== "None" ? `last visit ${formatDate(profile.stats.lastVisitAt)}` : ""].filter(Boolean).join(" · ") || "place profile"}
            </div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "38px", lineHeight: 1.05, margin: 0, fontWeight: 600 }}>{profile.place.name}</h1>
            <div style={{ fontSize: "12px", marginTop: "9px", opacity: 0.9 }}>
              {profile.place.address || "No address yet"}
            </div>
          </div>
          <button
            onClick={toggleFavorite}
            aria-label="Toggle favorite"
            title="Toggle favorite"
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              width: "34px",
              height: "34px",
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.7)",
              background: profile.place.favorite ? "var(--accent)" : "rgba(255,255,255,0.75)",
              color: profile.place.favorite ? "#fff" : "var(--ink)",
              cursor: "pointer",
              fontSize: "16px",
            }}
          >
            ★
          </button>
        </div>
        <div style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", alignItems: "flex-start", flexWrap: "wrap" }}>
            <p style={{ maxWidth: "560px", margin: 0, color: "var(--ink-2)", fontSize: "13px", lineHeight: 1.75 }}>
              {memorySignal}
            </p>
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <HeaderStat label="First visit" value={formatDate(profile.stats.firstVisitAt)} />
              <HeaderStat label="Last visit" value={formatDate(profile.stats.lastVisitAt)} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "10px", marginTop: "18px" }}>
            <Metric label="Visits" value={profile.stats.visitCount} />
            <Metric label="Photos" value={profile.stats.photoCount} />
            <Metric label="People" value={profile.stats.personCount} />
            <Metric label="Groups" value={profile.stats.groupCount} />
          </div>
        </div>
      </header>

      <div className="place-profile-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 310px", gap: "18px", alignItems: "start" }}>
        <main style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <Card title="At a glance" style={{ borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {summary.map(line => (
                <p key={line} style={{ margin: 0, color: "var(--ink-2)", fontSize: "13px", lineHeight: 1.7 }}>{line}</p>
              ))}
            </div>
          </Card>

          <Card title="Memory thread" style={{ borderRadius: "10px", overflow: "hidden" }}>
            {profile.timeline.length === 0 ? (
              <EmptyState icon="○" title="No events connected to this place yet." subtitle="Visits will appear here once Events are linked to this Place." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {profile.timeline.map(item => (
                  <div key={item.eventId} style={{ display: "grid", gridTemplateColumns: "78px minmax(0, 1fr)", gap: "12px", alignItems: "start" }}>
                    <div style={{ fontSize: "10px", color: "var(--ink-4)", paddingTop: "12px", textAlign: "right" }}>{formatDate(item.startedAt)}</div>
                    <div style={{ padding: "13px 14px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)" }}>
                      <div style={{ fontSize: "13px", color: "var(--ink)", fontWeight: 600 }}>{item.title}</div>
                      <MetaLine parts={[
                        item.people.map(p => p.name).join(", "),
                        item.groups.map(g => `${g.name}${g.associationType === "inferred" ? " inferred" : ""}`).join(", "),
                        item.photoCount ? `${item.photoCount} photos` : "",
                        item.spendAmount ? money(item.spendAmount) : "",
                      ]} />
                      {item.notePreview && <p style={{ margin: "8px 0 0", color: "var(--ink-3)", fontSize: "11px", lineHeight: 1.6 }}>{item.notePreview}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Photos" style={{ borderRadius: "10px", overflow: "hidden" }}>
            {profile.photos.length === 0 ? (
              <EmptyState icon="□" title="No photos connected to this place yet." subtitle="Media-like Items attached to Interactions at this Place will appear here." />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "10px" }}>
                {profile.photos.map(photo => (
                  <div key={`${photo.eventId}-${photo.itemId}`} style={{ border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden", background: "var(--bg)" }}>
                    <div style={{ aspectRatio: "1 / 1", background: "linear-gradient(135deg, #e6ddd0, #bfc8c1)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: "24px" }}>□</div>
                    <div style={{ padding: "8px" }}>
                      <div style={{ fontSize: "11px", color: "var(--ink)" }}>{photo.name}</div>
                      <div style={{ fontSize: "9px", color: "var(--ink-4)", marginTop: "2px" }}>{photo.eventTitle}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Notes" style={{ borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "14px" }}>
              <textarea
                value={noteBody}
                onChange={event => setNoteBody(event.target.value)}
                placeholder="Add a note to remember why this place matters."
                style={{ flex: 1, minHeight: "82px", resize: "vertical", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "10px", color: "var(--ink)", fontFamily: "inherit", fontSize: "12px" }}
              />
              <Button onClick={addNote} loading={saving} disabled={!noteBody.trim()} style={{ borderRadius: "7px", textTransform: "none", letterSpacing: 0 }}>Save</Button>
            </div>
            {profile.notes.length === 0 ? (
              <EmptyState icon="◇" title="No memories added yet." subtitle="Add a note to remember why this place matters." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {profile.notes.map(note => (
                  <div key={note.id} style={{ padding: "12px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)" }}>
                    {editingNoteId === note.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <textarea
                          value={editingBody}
                          onChange={event => setEditingBody(event.target.value)}
                          style={{ minHeight: "90px", resize: "vertical", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface)", padding: "10px", color: "var(--ink)", fontFamily: "inherit", fontSize: "12px" }}
                        />
                        <div style={{ display: "flex", gap: "8px" }}>
                          <Button size="sm" onClick={() => saveNote(note.id)} loading={saving} style={{ borderRadius: "6px", textTransform: "none", letterSpacing: 0 }}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingNoteId(null)} style={{ borderRadius: "6px", textTransform: "none", letterSpacing: 0 }}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--ink-2)", fontSize: "12px", lineHeight: 1.7 }}>{note.body}</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
                          <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{formatDate(note.createdAt)}</span>
                          <span style={{ display: "flex", gap: "6px" }}>
                            <button onClick={() => { setEditingNoteId(note.id); setEditingBody(note.body) }} style={noteButtonStyle}>Edit</button>
                            <button onClick={() => deleteNote(note.id)} style={noteButtonStyle}>Delete</button>
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </main>

        <aside style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <Card title="People here" style={{ borderRadius: "10px", overflow: "hidden" }}>
            {profile.people.length === 0 ? (
              <EmptyState icon="○" title="No people connected to this place yet." subtitle="People appear after Interactions link them to Events at this Place." />
            ) : (
              <SummaryList items={profile.people.map(person => ({
                key: person.personId,
                title: person.name,
                detail: `${person.sharedEventCount} shared ${person.sharedEventCount === 1 ? "visit" : "visits"} · ${formatDate(person.lastSharedEventAt)}`,
              }))} />
            )}
          </Card>

          <Card title="Groups here" style={{ borderRadius: "10px", overflow: "hidden" }}>
            {profile.groups.affiliated.length === 0 && profile.groups.activity.length === 0 ? (
              <EmptyState icon="◎" title="No groups connected to this place yet." subtitle="Affiliations and event activity groups will be separated here." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <GroupBlock title="Affiliated" items={profile.groups.affiliated.map(group => ({ key: group.groupId, title: group.name, detail: labelize(group.relationshipType ?? group.groupType) }))} />
                <GroupBlock title="Activity" items={profile.groups.activity.map(group => ({ key: group.groupId, title: group.name, detail: `${group.eventCount ?? 0} ${group.eventCount === 1 ? "event" : "events"}` }))} />
              </div>
            )}
          </Card>

          <Card title="Spending" style={{ borderRadius: "10px", overflow: "hidden" }}>
            {profile.stats.totalSpend ? (
              <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", color: "var(--ink)" }}>{money(profile.stats.totalSpend)}</div>
            ) : (
              <EmptyState icon="$" title="Connect Era Finance to see spending at this place." subtitle="Recorded Interaction amounts at this Place will be summed here." style={{ padding: "22px 12px" }} />
            )}
          </Card>

          <Card title="Plans" style={{ borderRadius: "10px", overflow: "hidden" }}>
            {profile.plans.length === 0 ? (
              <EmptyState icon="◇" title="No plans connected to this place yet." subtitle="Place-linked Plans will appear here once that graph edge exists." />
            ) : (
              <SummaryList items={profile.plans.map(plan => ({ key: plan.planId, title: plan.title, detail: formatDate(plan.plannedDate) }))} />
            )}
          </Card>
        </aside>
      </div>
    </div>
  )
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "9px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: "12px", color: "var(--ink-2)", marginTop: "2px" }}>{value}</div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px", background: "var(--bg)" }}>
      <div style={{ fontSize: "18px", color: "var(--ink)", fontWeight: 600 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: "9px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  )
}

function MetaLine({ parts }: { parts: string[] }) {
  const visible = parts.filter(Boolean)
  if (!visible.length) return null
  return <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "5px" }}>{visible.join(" · ")}</div>
}

function SummaryList({ items }: { items: { key: string; title: string; detail: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {items.map(item => (
        <div key={item.key} style={{ padding: "9px 10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)" }}>
          <div style={{ fontSize: "12px", color: "var(--ink)" }}>{item.title}</div>
          <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "2px" }}>{item.detail}</div>
        </div>
      ))}
    </div>
  )
}

function GroupBlock({ title, items }: { title: string; items: { key: string; title: string; detail: string }[] }) {
  if (!items.length) return null
  return (
    <div>
      <div style={{ fontSize: "9px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>{title}</div>
      <SummaryList items={items} />
    </div>
  )
}

function deterministicSummary(profile: PlaceProfile) {
  const lines: string[] = []
  if (profile.stats.visitCount > 0) {
    lines.push(`You've visited ${profile.stats.visitCount} ${profile.stats.visitCount === 1 ? "time" : "times"}${profile.stats.firstVisitAt ? ` since ${monthYear(profile.stats.firstVisitAt)}` : ""}.`)
  } else {
    lines.push("No visits are connected to this place yet.")
  }
  if (profile.people[0] && profile.people[0].sharedEventCount > 0) {
    lines.push(`Most shared visits were with ${profile.people[0].name}.`)
  } else {
    lines.push("No people have shared visits here yet.")
  }
  if (profile.stats.photoCount > 0) {
    lines.push(`${profile.stats.photoCount} ${profile.stats.photoCount === 1 ? "photo is" : "photos are"} connected to this place.`)
  } else {
    lines.push("No photos are connected to this place yet.")
  }
  if (profile.stats.groupCount > 0) {
    lines.push(`${profile.stats.groupCount} ${profile.stats.groupCount === 1 ? "group is" : "groups are"} connected through affiliations or event activity.`)
  } else {
    lines.push("No groups are connected to this place yet.")
  }
  if (profile.stats.lastVisitAt) {
    lines.push(`Last visit: ${formatDate(profile.stats.lastVisitAt)}.`)
  }
  return lines
}

function primaryMemorySignal(profile: PlaceProfile) {
  if (profile.notes[0]?.body) {
    return profile.notes[0].body
  }
  if (profile.timeline[0]) {
    const latest = profile.timeline[0]
    const people = latest.people.length ? ` with ${latest.people.map(person => person.name).join(", ")}` : ""
    return `Latest connected event: ${latest.title}${people} on ${formatDate(latest.startedAt)}.`
  }
  return "This page will come alive as Events, Interactions, photos, groups, notes, and spending connect to this Place."
}

function formatDate(value?: string) {
  if (!value) return "None"
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

function monthYear(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(value))
}

function money(value: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value)
}

function labelize(value: string) {
  return value.replaceAll("_", " ")
}

const noteButtonStyle = {
  border: "none",
  background: "transparent",
  color: "var(--ink-4)",
  fontFamily: "inherit",
  fontSize: "10px",
  cursor: "pointer",
  textDecoration: "underline",
}
