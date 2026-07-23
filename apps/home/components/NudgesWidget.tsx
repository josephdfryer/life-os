import { db } from '@life-os/db'
import { getRelationshipGaps } from '@life-os/alignment'

interface Props {
  workspaceId: string
  personsUrl: string
}

export default async function NudgesWidget({ workspaceId, personsUrl }: Props) {
  // Shared with Persons (Today page) and the assistant — one definition of
  // "overdue" instead of three apps quietly disagreeing with each other.
  const gaps = await getRelationshipGaps(workspaceId)
  const top = gaps.slice(0, 3)

  // Signals are intentionally minimal (kind/severity/subject/detail) so the
  // assistant can consume them as plain text — fetch the display-only summary
  // snippet here, bounded to the handful actually shown.
  const summaries = await Promise.all(
    top.map(signal =>
      signal.personId
        ? db.interaction.findFirst({
            where: { personId: signal.personId },
            orderBy: { timestamp: 'desc' },
            select: { summary: true },
          })
        : null
    )
  )

  const nudges = top.map((signal, i) => ({ signal, summary: summaries[i]?.summary ?? null }))

  return (
    <div style={card}>
      <h2 style={{ ...heading, marginBottom: '24px' }}>Relationship Nudges</h2>

      {nudges.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
          All relationships warm
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {nudges.map(({ signal, summary }) => (
            <div
              key={signal.personId}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{signal.subject}</div>
                <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '4px' }}>
                  {signal.detail}
                  {summary ? ` · ${summary.slice(0, 60)}` : ''}
                </div>
              </div>
              <a
                href={`${personsUrl}/people/${signal.personId}`}
                style={{
                  flexShrink: 0,
                  fontSize: '12px',
                  padding: '6px 16px',
                  background: 'var(--cognac)',
                  borderRadius: 'var(--radius-pill)',
                  color: '#fff',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Reach out
              </a>
            </div>
          ))}
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
