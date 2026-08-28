import { lifeOsAppUrl } from '@life-os/auth'
import { db } from '@life-os/db'
import { BACKGROUND_EVENT_TYPES } from '@life-os/domain'
import { dayKey, formatScheduleTime, isProviderScheduledEvent, reviewDayBounds } from '@/lib/daily'
import { cacheLife, unstable_cache } from 'next/cache'

interface Props {
  workspaceId: string
  personsUrl: string
  tz: string
}

export default async function ScheduleWidget({ workspaceId, personsUrl, tz }: Props) {
  'use cache'
  cacheLife({ stale: 300, revalidate: 30, expire: 86400 })
  const eventsUrl = lifeOsAppUrl('events', 'http://localhost:3006')
  const events = process.env.NODE_ENV === 'production'
    ? await getCachedScheduleEvents(workspaceId, tz, eventsUrl)
    : await loadScheduleEvents(workspaceId, tz, eventsUrl)

  return (
    <div className="dashboard-schedule-card" style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={heading}>Today</h2>
        <a href={eventsUrl} style={{ ...badge, textDecoration: 'none' }}>
          {events.length} {events.length === 1 ? 'event' : 'events'} →
        </a>
      </div>

      {events.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
          Clear day
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {events.map((event) => {
            const uniqueAttendees = [...new Map(event.attendees.map(person => [person.id, person])).values()].slice(0, 3)

            return (
              <div key={event.id} style={{ display: 'flex', gap: '24px' }}>
                <div
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: '12px',
                    color: 'var(--ink-3)',
                    paddingTop: '2px',
                    minWidth: '72px',
                    flexShrink: 0,
                  }}
                >
                  {formatScheduleTime(new Date(event.start), tz)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <a href={event.href} style={{ fontWeight: 500, lineHeight: 1.3, color: 'inherit', textDecoration: 'none' }}>
                      {event.name}
                    </a>
                    {event.scheduled && <span style={scheduledBadge}>Scheduled</span>}
                  </div>
                  {uniqueAttendees.length > 0 && (
                    <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '4px' }}>
                      with {uniqueAttendees.map((person, i) => (
                        <span key={person.id}>
                          {i > 0 && ', '}
                          <a href={`${personsUrl}/persons/${person.id}`} style={{ color: 'var(--camel)', textDecoration: 'none' }}>
                            {person.name}
                          </a>
                        </span>
                      ))}
                    </div>
                  )}
                  {event.place && (
                    <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '2px' }}>
                      {event.place.name}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

async function loadScheduleEvents(workspaceId: string, tz: string, eventsUrl: string) {
  const startedAt = Date.now()
  // Day boundaries in the user's own timezone, not the server's — the server
  // runs in UTC on Vercel, so plain Date component math here previously
  // showed tomorrow's events as "Today" for the UTC/local gap every day.
  const { start: todayStart, end: todayEnd } = reviewDayBounds(dayKey(new Date(), tz), tz)

  const [confirmedEvents, scheduledPlans] = await Promise.all([db.event.findMany({
    where: {
      workspaceId,
      type: { notIn: [...BACKGROUND_EVENT_TYPES] },
      start: { gte: todayStart, lt: todayEnd },
    },
    orderBy: { start: 'asc' },
    select: {
      id: true,
      name: true,
      type: true,
      start: true,
      place: { select: { name: true } },
      calendarLinks: { select: { id: true } },
      interactions: {
        where: { personId: { not: null } },
        select: {
          personId: true,
          person: { select: { first: true, last: true } },
        },
        take: 5,
      },
    },
    take: 8,
  }), db.plan.findMany({
    where: {
      workspaceId,
      externalSource: 'google-calendar',
      status: 'active',
      scheduledStart: { gte: todayStart, lt: todayEnd },
    },
    orderBy: { scheduledStart: 'asc' },
    select: {
      id: true,
      text: true,
      scheduledStart: true,
      place: { select: { name: true } },
      expectedPeople: {
        select: { person: { select: { id: true, first: true, last: true } } },
        take: 5,
      },
    },
    take: 8,
  })])
  const events = [
    ...confirmedEvents.map(event => ({
      id: event.id,
      name: event.name,
      start: event.start,
      place: event.place,
      scheduled: isProviderScheduledEvent(event),
      href: `${eventsUrl}/events/${event.id}`,
      attendees: event.interactions.flatMap(interaction => interaction.personId && interaction.person
        ? [{ id: interaction.personId, name: `${interaction.person.first} ${interaction.person.last ?? ''}`.trim() }]
        : []),
    })),
    ...scheduledPlans.flatMap(plan => plan.scheduledStart ? [{
      id: `plan-${plan.id}`,
      name: plan.text,
      start: plan.scheduledStart,
      place: plan.place,
      scheduled: true,
      href: eventsUrl,
      attendees: plan.expectedPeople.map(({ person }) => ({ id: person.id, name: `${person.first} ${person.last}`.trim() })),
    }] : []),
  ].sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, 8)
  console.log(JSON.stringify({ level: 'info', message: 'home widget loaded', widget: 'schedule', durationMs: Date.now() - startedAt, count: events.length }))
  return events
}

const getCachedScheduleEvents = unstable_cache(
  loadScheduleEvents,
  ['home-schedule-read-model-v1'],
  { revalidate: 30 },
)

const card: React.CSSProperties = {
  background: 'rgba(247, 244, 238, 0.045)',
  border: '1px solid rgba(196, 165, 116, 0.18)',
  borderRadius: 'var(--radius-lg)',
  padding: '32px',
}

const heading: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '1.4rem',
  fontWeight: 400,
  margin: 0,
}

const badge: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: '11px',
  padding: '4px 12px',
  background: 'rgba(196, 165, 116, 0.14)',
  color: 'var(--camel)',
  borderRadius: 'var(--radius-pill)',
}

const scheduledBadge: React.CSSProperties = {
  fontSize: '10px',
  padding: '2px 8px',
  color: 'var(--camel)',
  border: '1px solid rgba(196, 165, 116, 0.24)',
  borderRadius: 'var(--radius-pill)',
}
