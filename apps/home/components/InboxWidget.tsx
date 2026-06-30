import { db } from '@life-os/db'

interface Props {
  workspaceId: string
  personsUrl: string
}

export default async function InboxWidget({ workspaceId, personsUrl }: Props) {
  const pending = await db.stagedInteraction.findMany({
    where: { workspaceId, status: 'pending' },
    select: { source: true },
  })

  const total = pending.length
  const bySource: Record<string, number> = {}
  for (const p of pending) {
    const src = p.source ?? 'other'
    bySource[src] = (bySource[src] ?? 0) + 1
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
        <h2 style={heading}>Inbox</h2>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontFamily: 'var(--font-dm-mono)',
              fontSize: '3rem',
              fontWeight: 500,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {total}
          </div>
          <div style={{ fontSize: '11px', color: '#71717a', marginTop: '2px' }}>pending</div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px 32px',
          marginBottom: '32px',
        }}
      >
        {Object.entries(bySource).map(([source, count]) => (
          <div key={source} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
            <span style={{ color: '#a1a1aa', textTransform: 'capitalize' }}>{source}</span>
            <span style={{ fontFamily: 'var(--font-dm-mono)' }}>{count}</span>
          </div>
        ))}
        {total === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '16px 0', color: '#71717a' }}>
            Inbox is clear
          </div>
        )}
      </div>

      <a
        href={`${personsUrl}/inbox`}
        className="dashboard-inbox-link"
      >
        Process inbox →
      </a>
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
  fontFamily: 'var(--font-playfair)',
  fontSize: '1.4rem',
  fontWeight: 600,
  margin: 0,
}
