import { lifeOsAppUrl } from '@life-os/auth'
import { db } from '@life-os/db'

interface Props {
  workspaceId: string
}

export default async function ScheduleWidget({ workspaceId }: Props) {
  const eventsUrl = lifeOsAppUrl('events', 'http://localhost:3006')
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  const events = await db.event.findMany({
    where: {
      workspaceId,
      start: { gte: todayStart, lte: todayEnd },
    },
    orderBy: { start: 'asc' },
    include: {
      interactions: {
        where: { personId: { not: null } },
        include: { person: { select: { first: true, last: true } } },
        take: 5,
      },
    },
    take: 8,
  })

  function formatTime(d: Date) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={heading}>Today's Schedule</h2>
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
            const attendees = event.interactions
              .filter((i) => i.person)
              .map((i) => `${i.person!.first} ${i.person!.last ?? ''}`.trim())
            const uniqueAttendees = [...new Set(attendees)].slice(0, 3)

            return (
              <a
                key={event.id}
                href={`${eventsUrl}/events/${event.id}`}
                style={{ display: 'flex', gap: '24px', textDecoration: 'none', color: 'inherit' }}
              >
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
                  {formatTime(new Date(event.start))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, lineHeight: 1.3 }}>{event.name}</div>
                  {uniqueAttendees.length > 0 && (
                    <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '4px' }}>
                      with {uniqueAttendees.join(', ')}
                    </div>
                  )}
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
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
