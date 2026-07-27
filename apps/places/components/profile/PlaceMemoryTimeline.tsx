import { Card, EmptyState } from "@life-os/ui"
import { formatCurrency } from "@/lib/format"

export type MemoryTimelineItem = {
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
}

export function PlaceMemoryTimeline({ timeline, appUrls }: {
  timeline: MemoryTimelineItem[]
  appUrls: { persons: string; events: string }
}) {
  return (
    <Card title="Memory thread" style={{ borderRadius: "10px", overflow: "hidden" }}>
      {timeline.length === 0 ? (
        <EmptyState icon="○" title="No events connected to this place yet." subtitle="Visits will appear here once Events are linked to this Place." />
      ) : (
        <div className="place-memory-timeline">
          {groupTimeline(timeline).map(group => (
            <section key={group.key} className="place-memory-month">
              <h3>{group.label}</h3>
              {group.items.map(item => (
                <div key={item.eventId} className="place-memory-event">
                  <time dateTime={item.startedAt}>{dayLabel(item.startedAt)}</time>
                  <div>
                    <a className="place-event-link" href={`${appUrls.events}/events/${item.eventId}`}>{item.title}</a>
                    <div className="place-event-time-context">
                      {visitDuration(item.startedAt, item.endedAt)}
                      {item.gapSincePreviousVisitDays !== undefined ? ` · ${gapLabel(item.gapSincePreviousVisitDays)}` : ""}
                    </div>
                    <MetaLine parts={[
                      item.groups.map(group => `${group.name}${group.associationType === "inferred" ? " inferred" : ""}`).join(", "),
                      item.photoCount ? `${item.photoCount} photos` : "",
                      item.spendAmount ? formatCurrency(item.spendAmount) : "",
                    ]} />
                    {item.people.length ? <div className="place-event-people">{item.people.map(person => <a key={person.id} href={`${appUrls.persons}/persons/${person.id}`}>{person.name}</a>)}</div> : null}
                    {item.photos.length ? <div className="place-event-photos">{item.photos.map(photo => <span key={photo.id}>□ {photo.name}</span>)}</div> : null}
                    {item.notePreview ? <blockquote>{item.notePreview}</blockquote> : null}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </Card>
  )
}

function MetaLine({ parts }: { parts: string[] }) {
  const visible = parts.filter(Boolean)
  return visible.length ? <div className="place-event-meta">{visible.join(" · ")}</div> : null
}

function groupTimeline(timeline: MemoryTimelineItem[]) {
  const groups = new Map<string, { key: string; label: string; items: MemoryTimelineItem[] }>()
  for (const item of timeline) {
    const date = new Date(item.startedAt)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    const group = groups.get(key) ?? {
      key,
      label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date),
      items: [],
    }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric" }).format(new Date(value))
}

function visitDuration(start: string, end?: string) {
  if (!end) return "Duration not recorded"
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000)
  if (!Number.isFinite(minutes) || minutes <= 0) return "Duration not recorded"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`
}

function gapLabel(days: number) {
  if (days === 0) return "same-day return"
  if (days === 1) return "1 day since prior visit"
  return `${days.toLocaleString()} days since prior visit`
}
