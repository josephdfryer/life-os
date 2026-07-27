"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { BackLink, Button, Card, EmptyState } from "@life-os/ui"
import { formatCurrency, formatDate as formatLocalDate, formatInteger, formatMonthYear } from "@/lib/format"
import { PlaceMemoryTimeline } from "@/components/profile/PlaceMemoryTimeline"

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
    coordinates?: string | null
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
    endedAt?: string
    gapSincePreviousVisitDays?: number
    people: { id: string; name: string }[]
    groups: { id: string; name: string; associationType: "explicit_tag" | "inferred" | "place_affiliation" }[]
    photoCount: number
    photos: { id: string; name: string }[]
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

type ProfileNavigation = {
  position: number
  total: number
  previous: { name: string; href: string } | null
  next: { name: string; href: string } | null
} | null

export default function PlaceProfileClient({
  initialProfile,
  navigation,
  appUrls,
}: {
  initialProfile: PlaceProfile | null
  navigation: ProfileNavigation
  appUrls: { persons: string; events: string }
}) {
  const searchParams = useSearchParams()
  const returnQuery = searchParams.get("from")
  const backHref = returnQuery ? `/places?${returnQuery}` : "/places"
  const [profile, setProfile] = useState(initialProfile)
  const [noteBody, setNoteBody] = useState("")
  const [noteEventId, setNoteEventId] = useState("")
  const [meaningDraft, setMeaningDraft] = useState(initialProfile?.place.meaning ?? "")
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState("")
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null)
  const meaningDirty = meaningDraft !== (profile?.place.meaning ?? "")
  const hasUnsavedDraft = Boolean(noteBody.trim() || editingNoteId || meaningDirty)

  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedDraft) return
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warnUnsaved)
    return () => window.removeEventListener("beforeunload", warnUnsaved)
  }, [hasUnsavedDraft])

  if (!profile) {
    return (
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "32px 24px" }}>
        <BackLink label="All Places" href={backHref} component={Link} style={{ marginBottom: "20px" }} />
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }}>
          <EmptyState icon="?" title="Place not found" subtitle="This place may have been deleted." />
        </div>
      </div>
    )
  }

  async function toggleFavorite() {
    if (!profile) return
    setMutationError(null)
    setMutationSuccess(null)
    const res = await fetch(`/api/places/${profile.place.id}/favorite`, { method: "POST" })
    if (res.ok) {
      const place = await res.json()
      setProfile({ ...profile, place: { ...profile.place, favorite: place.favorite } })
      setMutationSuccess(place.favorite ? "Added to favorites." : "Removed from favorites.")
    } else {
      setMutationError("Favorite could not be updated. Try again.")
    }
  }

  async function addNote() {
    if (!profile || !noteBody.trim()) return
    setSaving(true)
    setMutationError(null)
    setMutationSuccess(null)
    try {
      const response = await fetch(`/api/places/${profile.place.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody, eventId: noteEventId || undefined }),
      })
      if (!response.ok) throw new Error("note create failed")
      const note = await response.json() as PlaceNote
      const notes = [note, ...profile.notes]
      setProfile({
        ...profile,
        notes,
        stats: { ...profile.stats, noteCount: profile.stats.noteCount + 1 },
        timeline: timelineWithNotePreviews(profile.timeline, notes),
      })
      setNoteBody("")
      setNoteEventId("")
      setMutationSuccess(noteEventId ? "Visit note saved." : "Place note saved.")
    } catch {
      setMutationError("Your note was not saved. The draft is still here so you can try again.")
    } finally {
      setSaving(false)
    }
  }

  async function saveNote(noteId: string) {
    if (!profile || !editingBody.trim()) return
    setSaving(true)
    setMutationError(null)
    setMutationSuccess(null)
    try {
      const response = await fetch(`/api/places/${profile.place.id}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editingBody }),
      })
      if (!response.ok) throw new Error("note update failed")
      const updated = await response.json() as PlaceNote
      const notes = profile.notes.map(note => note.id === noteId ? updated : note)
      setProfile({
        ...profile,
        notes,
        timeline: timelineWithNotePreviews(profile.timeline, notes),
      })
      setEditingNoteId(null)
      setEditingBody("")
      setMutationSuccess("Note updated.")
    } catch {
      setMutationError("Your changes were not saved. The draft is still here so you can try again.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteNote(noteId: string) {
    if (!profile || !confirm("Delete this place note?")) return
    setSaving(true)
    setMutationError(null)
    setMutationSuccess(null)
    try {
      const response = await fetch(`/api/places/${profile.place.id}/notes/${noteId}`, { method: "DELETE" })
      if (!response.ok) throw new Error("note delete failed")
      const remainingNotes = profile.notes.filter(note => note.id !== noteId)
      setProfile({
        ...profile,
        notes: remainingNotes,
        stats: { ...profile.stats, noteCount: Math.max(0, profile.stats.noteCount - 1) },
        timeline: timelineWithNotePreviews(profile.timeline, remainingNotes),
      })
      setMutationSuccess("Note deleted.")
    } catch {
      setMutationError("The note could not be deleted. Try again.")
    } finally {
      setSaving(false)
    }
  }

  async function saveMeaning() {
    if (!profile || !meaningDirty || meaningDraft.trim().length > 2_000) return
    setSaving(true)
    setMutationError(null)
    setMutationSuccess(null)
    try {
      const response = await fetch(`/api/places/${profile.place.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meaning: meaningDraft }),
      })
      if (!response.ok) throw new Error("meaning update failed")
      const place = await response.json()
      setProfile({ ...profile, place: { ...profile.place, meaning: place.meaning } })
      setMeaningDraft(place.meaning ?? "")
      setMutationSuccess(place.meaning ? "Why this place matters was saved." : "Authored meaning removed.")
    } catch {
      setMutationError("Your meaning was not saved. The draft is still here so you can try again.")
    } finally {
      setSaving(false)
    }
  }

  const summary = deterministicSummary(profile)
  const memorySignal = primaryMemorySignal(profile)
  const mapTile = placeMapTile(profile.place.coordinates)
  const cadence = visitCadence(profile.timeline)

  return (
    <div style={{ maxWidth: "1040px", margin: "0 auto", padding: "32px 24px 48px" }}>
      <BackLink label="All Places" href={backHref} component={Link} style={{ marginBottom: "20px" }} />
      {navigation ? <ProfileNavigationBar navigation={navigation} /> : null}

      <header className="place-memory-header">
        <div className="place-memory-identity">
          <div className="place-memory-kicker">
            {[profile.place.type, profile.stats.visitCount ? `${profile.stats.visitCount} ${profile.stats.visitCount === 1 ? "visit" : "visits"}` : ""].filter(Boolean).join(" · ") || "Place memory"}
          </div>
          <h1>{profile.place.name}</h1>
          <p>{profile.place.address || "No address yet"}</p>
          <div className="place-memory-signal">{memorySignal}</div>
          <button
            onClick={toggleFavorite}
            aria-label="Toggle favorite"
            aria-pressed={profile.place.favorite}
            title="Toggle favorite"
            className="place-favorite-button"
          >
            {profile.place.favorite ? "★ Favorited" : "☆ Add to favorites"}
          </button>
        </div>
        <div className="place-memory-location">
          {mapTile ? (
            <>
              <img src={mapTile.src} alt="" width={256} height={256} />
              <a href={mapTile.href} target="_blank" rel="noreferrer">© OpenStreetMap contributors ↗</a>
            </>
          ) : (
            <div className="place-memory-location-empty">No coordinates yet</div>
          )}
        </div>
        <div className="place-memory-stats">
          <HeaderStat label="First visit" value={formatDate(profile.stats.firstVisitAt)} />
          <HeaderStat label="Last visit" value={formatDate(profile.stats.lastVisitAt)} />
          <Metric label="Visits" value={profile.stats.visitCount} />
          {cadence ? <HeaderStat label="Cadence" value={cadence.shortLabel} /> : null}
          {profile.stats.personCount ? <Metric label="People" value={profile.stats.personCount} /> : null}
          {profile.stats.photoCount ? <Metric label="Photos" value={profile.stats.photoCount} /> : null}
          {profile.stats.groupCount ? <Metric label="Groups" value={profile.stats.groupCount} /> : null}
        </div>
      </header>

      <div className="place-profile-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 310px", gap: "18px", alignItems: "start" }}>
        <main style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <Card title="At a glance" style={{ borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {summary.map(line => (
                <p key={line} style={{ margin: 0, color: "var(--ink-2)", fontSize: "13px", lineHeight: 1.7 }}>{line}</p>
              ))}
              {cadence ? <p className="place-cadence-narrative">{cadence.narrative}</p> : null}
            </div>
          </Card>

          <Card title="Why this place matters" style={{ borderRadius: "10px", overflow: "hidden" }}>
            <p className="place-authored-label">Written by you — never generated</p>
            <textarea
              value={meaningDraft}
              maxLength={2000}
              onChange={event => setMeaningDraft(event.target.value)}
              placeholder="What makes this place meaningful in your life?"
              className="place-meaning-input"
            />
            <div className="place-meaning-actions">
              <span>{meaningDraft.length.toLocaleString()} / 2,000</span>
              {meaningDirty ? <button type="button" onClick={() => setMeaningDraft(profile.place.meaning ?? "")}>Discard</button> : null}
              <Button onClick={saveMeaning} loading={saving} disabled={!meaningDirty}>Save meaning</Button>
            </div>
          </Card>

          <PlaceMemoryTimeline timeline={profile.timeline} appUrls={appUrls} />

          {profile.photos.length ? (
            <Card title="Photos" style={{ borderRadius: "10px", overflow: "hidden" }}>
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
            </Card>
          ) : null}

          <Card title="Notes" style={{ borderRadius: "10px", overflow: "hidden" }}>
            {mutationError ? <div className="place-mutation-error" role="alert">{mutationError}</div> : null}
            {mutationSuccess ? <div className="place-mutation-success" role="status">{mutationSuccess}</div> : null}
            <div className="place-note-composer">
              <label>
                <span>Attach to</span>
                <select value={noteEventId} onChange={event => setNoteEventId(event.target.value)}>
                  <option value="">The Place generally</option>
                  {profile.timeline.map(event => <option key={event.eventId} value={event.eventId}>{event.title} · {formatDate(event.startedAt)}</option>)}
                </select>
              </label>
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
                        {note.eventId ? <a className="place-note-event-link" href={`${appUrls.events}/events/${note.eventId}`}>Attached to {profile.timeline.find(event => event.eventId === note.eventId)?.title ?? "visit"} ↗</a> : null}
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
          {profile.people.length ? (
            <Card title="People here" style={{ borderRadius: "10px", overflow: "hidden" }}>
              <SummaryList items={profile.people.map(person => ({
                key: person.personId,
                title: person.name,
                detail: `${person.sharedEventCount} shared ${person.sharedEventCount === 1 ? "visit" : "visits"} · ${formatDate(person.lastSharedEventAt)}`,
                href: `${appUrls.persons}/persons/${person.personId}`,
              }))} />
            </Card>
          ) : null}

          {profile.groups.affiliated.length || profile.groups.activity.length ? (
            <Card title="Groups here" style={{ borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <GroupBlock title="Affiliated" items={profile.groups.affiliated.map(group => ({ key: group.groupId, title: group.name, detail: labelize(group.relationshipType ?? group.groupType) }))} />
                <GroupBlock title="Activity" items={profile.groups.activity.map(group => ({ key: group.groupId, title: group.name, detail: `${group.eventCount ?? 0} ${group.eventCount === 1 ? "event" : "events"}` }))} />
              </div>
            </Card>
          ) : null}

          {profile.stats.totalSpend ? (
            <Card title="Spending" style={{ borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", color: "var(--ink)" }}>{money(profile.stats.totalSpend)}</div>
            </Card>
          ) : null}

          {profile.plans.length ? (
            <Card title="Plans" style={{ borderRadius: "10px", overflow: "hidden" }}>
              <SummaryList items={profile.plans.map(plan => ({ key: plan.planId, title: plan.title, detail: formatDate(plan.plannedDate) }))} />
            </Card>
          ) : null}
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
      <div style={{ fontSize: "18px", color: "var(--ink)", fontWeight: 600 }}>{formatInteger(value)}</div>
      <div style={{ fontSize: "9px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  )
}

function SummaryList({ items }: { items: { key: string; title: string; detail: string; href?: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {items.map(item => (
        <div key={item.key} style={{ padding: "9px 10px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)" }}>
          {item.href
            ? <a href={item.href} className="place-summary-link">{item.title}</a>
            : <div style={{ fontSize: "12px", color: "var(--ink)" }}>{item.title}</div>}
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
  }
  if (profile.stats.photoCount > 0) {
    lines.push(`${profile.stats.photoCount} ${profile.stats.photoCount === 1 ? "photo is" : "photos are"} connected to this place.`)
  }
  if (profile.stats.groupCount > 0) {
    lines.push(`${profile.stats.groupCount} ${profile.stats.groupCount === 1 ? "group is" : "groups are"} connected through affiliations or event activity.`)
  }
  if (profile.stats.lastVisitAt) {
    lines.push(`Last visit: ${formatDate(profile.stats.lastVisitAt)}.`)
  }
  return lines
}

function primaryMemorySignal(profile: PlaceProfile) {
  if (profile.place.meaning) {
    return profile.place.meaning
  }
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

function ProfileNavigationBar({ navigation }: { navigation: NonNullable<ProfileNavigation> }) {
  return (
    <nav className="place-profile-navigation" aria-label="Places in current results">
      {navigation.previous
        ? <Link href={navigation.previous.href} aria-label={`Previous Place: ${navigation.previous.name}`}>← {navigation.previous.name}</Link>
        : <span />}
      <span>{navigation.position} of {navigation.total}</span>
      {navigation.next
        ? <Link href={navigation.next.href} aria-label={`Next Place: ${navigation.next.name}`}>{navigation.next.name} →</Link>
        : <span />}
    </nav>
  )
}

function visitCadence(timeline: PlaceProfile["timeline"]) {
  if (timeline.length < 2) return null
  const times = timeline
    .map(event => new Date(event.startedAt).getTime())
    .filter(Number.isFinite)
    .toSorted((a, b) => a - b)
  if (times.length < 2) return null
  const spanDays = Math.max(1, Math.round((times[times.length - 1] - times[0]) / 86_400_000))
  const averageGapDays = Math.max(1, Math.round(spanDays / (times.length - 1)))
  const shortLabel = averageGapDays < 14
    ? `Every ${averageGapDays} days`
    : averageGapDays < 60
      ? `Every ${Math.round(averageGapDays / 7)} weeks`
      : `Every ${Math.round(averageGapDays / 30)} months`
  return {
    shortLabel,
    narrative: `${times.length} connected visits span ${spanLabel(spanDays)}, averaging about ${shortLabel.toLocaleLowerCase()}.`,
  }
}

function spanLabel(days: number) {
  if (days < 14) return `${days} days`
  if (days < 60) return `${Math.round(days / 7)} weeks`
  if (days < 730) return `${Math.round(days / 30)} months`
  return `${(days / 365).toFixed(1)} years`
}

function timelineWithNotePreviews(timeline: PlaceProfile["timeline"], notes: PlaceNote[]) {
  return timeline.map(event => ({
    ...event,
    notePreview: notes.find(note => note.eventId === event.eventId)?.body.slice(0, 140),
  }))
}

function formatDate(value?: string) {
  if (!value) return "None"
  return formatLocalDate(value)
}

function monthYear(value: string) {
  return formatMonthYear(value)
}

function money(value: number) {
  return formatCurrency(value)
}

function labelize(value: string) {
  return value.replaceAll("_", " ")
}

function placeMapTile(value?: string | null) {
  if (!value) return null
  try {
    const coordinates = JSON.parse(value) as { lat?: number; lng?: number; latitude?: number; longitude?: number }
    const latitude = coordinates.latitude ?? coordinates.lat
    const longitude = coordinates.longitude ?? coordinates.lng
    if (typeof latitude !== "number" || typeof longitude !== "number") return null
    const zoom = 15
    const scale = 2 ** zoom
    const x = Math.floor((longitude + 180) / 360 * scale)
    const latitudeRadians = latitude * Math.PI / 180
    const y = Math.floor((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * scale)
    return {
      src: `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`,
      href: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=${zoom}/${latitude}/${longitude}`,
    }
  } catch {
    return null
  }
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
