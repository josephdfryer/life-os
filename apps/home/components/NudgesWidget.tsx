import { db } from '@life-os/db'

interface Props {
  workspaceId: string
  personsUrl: string
}

export default async function NudgesWidget({ workspaceId, personsUrl }: Props) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Fetch persons with closeness >= 3, include their most recent interaction
  const persons = await db.person.findMany({
    where: { workspaceId, closeness: { gte: 3 } },
    include: {
      interactions: {
        orderBy: { timestamp: 'desc' },
        take: 1,
        select: { timestamp: true, summary: true },
      },
    },
    take: 100, // fetch a reasonable set to filter from
  })

  // Filter to those not contacted in 30 days, sort oldest first, take top 3
  const nudges = persons
    .filter((p) => {
      const last = p.interactions[0]?.timestamp
      return !last || new Date(last) < thirtyDaysAgo
    })
    .sort((a, b) => {
      const aLast = a.interactions[0]?.timestamp
        ? new Date(a.interactions[0].timestamp).getTime()
        : 0
      const bLast = b.interactions[0]?.timestamp
        ? new Date(b.interactions[0].timestamp).getTime()
        : 0
      return aLast - bLast
    })
    .slice(0, 3)

  return (
    <div style={card}>
      <h2 style={{ ...heading, marginBottom: '24px' }}>Relationship Nudges</h2>

      {nudges.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: '#71717a' }}>
          All relationships warm
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {nudges.map((person) => {
            const last = person.interactions[0]
            const daysAgo = last?.timestamp
              ? Math.floor((Date.now() - new Date(last.timestamp).getTime()) / 86400000)
              : null

            return (
              <div
                key={person.id}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>
                    {person.first} {person.last}
                  </div>
                  <div style={{ fontSize: '12px', color: '#71717a', marginTop: '4px' }}>
                    {daysAgo !== null ? `${daysAgo} days ago` : 'Never contacted'}
                    {last?.summary ? ` · ${last.summary.slice(0, 60)}` : ''}
                  </div>
                </div>
                <a
                  href={`${personsUrl}/people/${person.id}`}
                  style={{
                    flexShrink: 0,
                    fontSize: '12px',
                    padding: '6px 16px',
                    background: '#27272a',
                    borderRadius: '999px',
                    color: '#e4e4e7',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Reach out
                </a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const card: React.CSSProperties = {
  background: 'rgba(24,24,27,0.5)',
  border: '1px solid #27272a',
  borderRadius: '24px',
  padding: '32px',
}

const heading: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '1.4rem',
  fontWeight: 600,
  margin: 0,
}
