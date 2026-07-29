import { db } from '@life-os/db'

interface Props {
  workspaceId: string
  personsUrl: string
}

export default async function InboxWidget({ workspaceId, personsUrl }: Props) {
  const pending = await db.stagedInteraction.findMany({
    // Financial staging (era) has its own review surface — not this inbox.
    where: { workspaceId, status: 'pending', type: { not: 'financial' } },
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
              fontFamily: 'var(--font-body)',
              fontSize: '3rem',
              fontWeight: 500,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {total}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--camel)', marginTop: '2px' }}>pending</div>
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
            <span style={{ color: 'var(--ink-3)' }}>{sourceLabel(source)}</span>
            <span style={{ fontFamily: 'var(--font-body)' }}>{count}</span>
          </div>
        ))}
        {total === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '16px 0', color: 'var(--ink-3)' }}>
            Inbox is clear
          </div>
        )}
      </div>

      <a href={`${personsUrl}/inbox`} className="dashboard-inbox-link">
        Process inbox →
      </a>
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

function sourceLabel(source: string) {
  if (source === 'imessage') return 'iMessage'
  if (source === 'gmail') return 'Email'
  if (source === 'whatsapp') return 'WhatsApp'
  return source
}
