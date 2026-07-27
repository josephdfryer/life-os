import { db } from '@life-os/db'
import { parseActionItems } from '@/lib/daily'

interface Props {
  workspaceId: string
  personsUrl: string
}

export default async function ActionItemsWidget({ workspaceId, personsUrl }: Props) {
  const [interactions, plans] = await Promise.all([
    db.interaction.findMany({
      where: { workspaceId, actionItems: { not: null } },
      orderBy: { timestamp: 'desc' },
      select: {
        id: true,
        timestamp: true,
        actionItems: true,
        person: { select: { id: true, first: true, last: true } },
        event: { select: { name: true } },
      },
      take: 20,
    }),
    db.plan.findMany({
      where: { workspaceId, status: { in: ['active', 'blocked'] }, scheduledStart: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        text: true,
        status: true,
        person: { select: { id: true, first: true, last: true } },
      },
      take: 5,
    }),
  ])

  // Parse actionItems JSON string and flatten
  type ActionRow = {
    id: string
    item: string
    personName: string | null
    personId: string | null
    eventName: string | null
    timestamp: Date
  }

  const rows: ActionRow[] = []
  for (const interaction of interactions) {
    for (const item of parseActionItems(interaction.actionItems).filter(item => !item.completed)) {
      rows.push({
        id: `${interaction.id}-${rows.length}`,
        item: item.description,
        personName: interaction.person
          ? `${interaction.person.first} ${interaction.person.last ?? ''}`.trim()
          : null,
        personId: interaction.person?.id ?? null,
        eventName: interaction.event?.name ?? null,
        timestamp: new Date(interaction.timestamp),
      })
    }
    if (rows.length >= 10) break
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={heading}>Commitments</h2>
          <div style={eyebrow}>What remains open</div>
        </div>
        <a
          href={personsUrl}
          style={{ fontSize: '12px', color: 'var(--camel)', textDecoration: 'none' }}
        >
          Persons →
        </a>
      </div>

      {plans.length === 0 && rows.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
          Nothing open right now
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {plans.map(plan => (
            <div key={plan.id} style={commitmentRow}>
              <div style={{ fontSize: '14px', lineHeight: 1.4 }}>{plan.text}</div>
              <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '4px' }}>
                {plan.status === 'blocked' ? 'Blocked plan' : 'Active plan'}
                {plan.person ? ` · ${plan.person.first} ${plan.person.last}` : ''}
              </div>
            </div>
          ))}
          {rows.map((row) => (
            <div key={row.id} style={commitmentRow}>
              <div style={{ fontSize: '14px', lineHeight: 1.4 }}>{row.item}</div>
              <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '4px' }}>
                {row.personName ? (
                  <a
                    href={`${personsUrl}/persons/${row.personId}`}
                    style={{ color: 'var(--camel)', textDecoration: 'none' }}
                  >
                    {row.personName}
                  </a>
                ) : '—'}
                {row.eventName ? ` · ${row.eventName}` : ''}
              </div>
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

const eyebrow: React.CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '11px',
  marginTop: '3px',
}

const commitmentRow: React.CSSProperties = {
  borderLeft: '2px solid rgba(196, 165, 116, 0.34)',
  paddingLeft: '12px',
  paddingTop: '6px',
  paddingBottom: '6px',
}
