import { lifeOsAppUrl } from '@life-os/auth'
import { db } from '@life-os/db'
import { parseActionItems } from '@/lib/daily'
import { cacheLife } from 'next/cache'

interface Props {
  workspaceId: string
}

export default async function PrepareWidget({ workspaceId }: Props) {
  'use cache'
  cacheLife({ stale: 15, revalidate: 30, expire: 300 })
  const now = new Date()
  const horizon = new Date(now.getTime() + 18 * 60 * 60 * 1000)
  const eventsUrl = lifeOsAppUrl('events', 'http://localhost:3006')
  const personsUrl = lifeOsAppUrl('persons', 'http://localhost:3000')

  const upcoming = await db.event.findMany({
    where: {
      workspaceId,
      start: { gte: now, lte: horizon },
      interactions: { some: { personId: { not: null } } },
    },
    orderBy: { start: 'asc' },
    select: {
      id: true,
      name: true,
      start: true,
      interactions: {
        where: { personId: { not: null } },
        select: {
          personId: true,
          person: { select: { id: true, first: true, last: true } },
        },
        take: 5,
      },
    },
    take: 3,
  })

  const personIds = [...new Set(upcoming.flatMap(event =>
    event.interactions.flatMap(interaction => interaction.personId ? [interaction.personId] : [])
  ))]
  const history = personIds.length
    ? await db.interaction.findMany({
        where: { workspaceId, personId: { in: personIds }, timestamp: { lt: now } },
        orderBy: { timestamp: 'desc' },
        select: { personId: true, summary: true, outcome: true, actionItems: true },
        take: 50,
      })
    : []

  const latestByPerson = new Map<string, typeof history[number]>()
  for (const interaction of history) {
    if (interaction.personId && !latestByPerson.has(interaction.personId)) {
      latestByPerson.set(interaction.personId, interaction)
    }
  }

  if (!upcoming.length) return null

  return (
    <section style={card} aria-labelledby="prepare-heading">
      <div style={{ marginBottom: '22px' }}>
        <div style={eyebrow}>Before you walk in</div>
        <h2 id="prepare-heading" style={heading}>Prepare</h2>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {upcoming.map(event => (
          <div key={event.id} style={eventRow}>
            <a href={`${eventsUrl}/events/${event.id}`} style={{ fontWeight: 500, fontSize: '15px' }}>
              {event.name}
            </a>
            <div style={{ color: 'var(--ink-3)', fontSize: '12px', marginTop: '3px' }}>
              {event.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
              {event.interactions.flatMap(interaction => interaction.person ? [interaction.person] : []).map(person => {
                const latest = latestByPerson.get(person.id)
                const openItems = parseActionItems(latest?.actionItems ?? null).filter(item => !item.completed)
                return (
                  <div key={person.id}>
                    <a href={`${personsUrl}/persons/${person.id}`} style={{ color: 'var(--camel)', fontSize: '13px' }}>
                      {person.first} {person.last}
                    </a>
                    <div style={{ color: 'var(--ink-3)', fontSize: '12px', marginTop: '2px', lineHeight: 1.45 }}>
                      {latest
                        ? `Last: ${latest.summary || latest.outcome || 'interaction recorded'}${openItems[0] ? ` · Open: ${openItems[0].description}` : ''}`
                        : 'No earlier interaction context'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
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

const eyebrow: React.CSSProperties = {
  color: 'var(--camel)',
  fontSize: '11px',
  marginBottom: '3px',
}

const eventRow: React.CSSProperties = {
  paddingBottom: '18px',
  borderBottom: '1px solid rgba(196, 165, 116, 0.14)',
}
