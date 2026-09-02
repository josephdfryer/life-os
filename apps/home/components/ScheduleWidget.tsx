import { lifeOsAppUrl } from '@life-os/auth'
import { listScheduleItems } from '@life-os/domain'
import { dayKey, zonedDayBounds } from '@life-os/ui'
import { unstable_cache } from 'next/cache'
import ScheduleList, { type ScheduleRow } from './ScheduleList'

interface Props {
  workspaceId: string
  personsUrl: string
  tz: string
}

export default async function ScheduleWidget({ workspaceId, personsUrl, tz }: Props) {
  const eventsUrl = lifeOsAppUrl('events', 'http://localhost:3006')
  let events: ScheduleRow[] = []
  let failed = false
  try {
    events = process.env.NODE_ENV === 'production'
      ? await getCachedScheduleEvents(workspaceId, tz, eventsUrl)
      : await loadScheduleEvents(workspaceId, tz, eventsUrl)
  } catch (error) {
    console.error('[home] schedule widget failed', error)
    failed = true
  }

  return (
    <div className="dashboard-schedule-card" style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={heading}>Today</h2>
        <a href={`${eventsUrl}/events?view=today`} style={{ ...badge, textDecoration: 'none' }}>
          {events.length} {events.length === 1 ? 'event' : 'events'} →
        </a>
      </div>

      {failed ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: '13px', lineHeight: 1.55 }}>
          Today&apos;s schedule is temporarily unavailable.
          <a href={`${eventsUrl}/events?view=today`} style={{ display: 'block', marginTop: '10px', color: 'var(--camel)' }}>
            Open Events →
          </a>
        </div>
      ) : events.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
          Clear day
        </div>
      ) : (
        <ScheduleList events={events} personsUrl={personsUrl} tz={tz} />
      )}
    </div>
  )
}

async function loadScheduleEvents(workspaceId: string, tz: string, eventsUrl: string) {
  const startedAt = Date.now()
  const bounds = zonedDayBounds(dayKey(new Date(), tz), tz)
  const items = await listScheduleItems({
    workspaceId,
    view: 'today',
    dayStart: bounds.start,
    dayEnd: bounds.end,
    take: 50,
    eventHref: (eventId) => `${eventsUrl}/events/${eventId}`,
  })
  console.log(JSON.stringify({ level: 'info', message: 'home widget loaded', widget: 'schedule', durationMs: Date.now() - startedAt, count: items.length }))
  return items.map(item => ({
    id: item.id,
    name: item.name,
    start: item.start.toISOString(),
    href: item.href,
    scheduled: item.scheduled,
    place: item.place,
    attendees: item.attendees,
    calendars: item.calendars,
    planId: item.planId,
    eventId: item.eventId,
    declaredAttendance: item.declaredAttendance,
    reconciliationStatus: item.reconciliationStatus,
    tension: item.tension,
    phase: item.phase,
  }))
}

function getCachedScheduleEvents(workspaceId: string, tz: string, eventsUrl: string) {
  return unstable_cache(
    async () => loadScheduleEvents(workspaceId, tz, eventsUrl),
    ['home-schedule-read-model-v2', workspaceId, tz],
    { revalidate: 30, tags: ['home-schedule'] },
  )()
}

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
