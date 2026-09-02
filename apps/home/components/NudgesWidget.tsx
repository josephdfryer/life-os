import { getAlignmentSignals } from '@life-os/alignment'
import { unstable_cache } from 'next/cache'

interface Props {
  workspaceId: string
  personsUrl: string
}

const MAX_NUDGES = 5

export default async function NudgesWidget({ workspaceId, personsUrl }: Props) {
  const startedAt = Date.now()
  let failed = false
  let nudges: Array<{ signal: Awaited<ReturnType<typeof getAlignmentSignals>>[number]; summary: string | null }> = []

  try {
    // Shared with Persons (Today page) and the assistant — one definition of
    // "overdue" instead of three apps quietly disagreeing with each other.
    const combined = (await (process.env.NODE_ENV === 'production'
      ? getCachedAlignmentSignals(workspaceId)
      : getAlignmentSignals(workspaceId))).sort((a, b) => b.severity - a.severity)
    const seen = new Set<string>()
    const top = combined.filter(signal => {
      if (!signal.personId || seen.has(signal.personId)) return !signal.personId
      seen.add(signal.personId)
      return true
    }).slice(0, MAX_NUDGES)

    nudges = top.map(signal => ({ signal, summary: signal.evidenceSummary ?? null }))
    console.log(JSON.stringify({ level: 'info', message: 'home widget loaded', widget: 'attention', durationMs: Date.now() - startedAt, count: nudges.length }))
  } catch (error) {
    console.error('[home] nudges widget failed', error)
    failed = true
  }

  const subtitle = failed
    ? 'Attention list unavailable'
    : nudges.length === 0
      ? 'All caught up'
      : nudges.length === 1
        ? 'One worthwhile nudge'
        : `${nudges.length} people need attention`

  return (
    <div className="dashboard-nudges-card" style={card}>
      <div style={{ color: 'var(--camel)', fontSize: '11px', marginBottom: '3px' }}>{subtitle}</div>
      <h2 style={{ ...heading, marginBottom: '24px' }}>Who deserves attention?</h2>

      {failed ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: '13px', lineHeight: 1.55 }}>
          Relationship nudges are temporarily unavailable.
          <a href={`${personsUrl}/today`} style={{ display: 'block', marginTop: '10px', color: 'var(--camel)' }}>
            Open Persons →
          </a>
        </div>
      ) : nudges.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
          All relationships warm
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {nudges.map(({ signal, summary }) => (
            <div
              key={signal.personId ?? signal.subject}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{signal.subject}</div>
                <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '4px' }}>
                  {signal.detail}
                  {summary ? ` · ${summary.slice(0, 60)}` : ''}
                </div>
              </div>
              {signal.personId ? (
                <a
                  href={`${personsUrl}/persons/${signal.personId}`}
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
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function getCachedAlignmentSignals(workspaceId: string) {
  return unstable_cache(
    async () => getAlignmentSignals(workspaceId),
    ['home-attention-read-model-v2', workspaceId],
    { revalidate: 60 },
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
