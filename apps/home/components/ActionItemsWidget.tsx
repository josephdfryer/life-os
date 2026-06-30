import { db } from '@life-os/db'

interface Props {
  workspaceId: string
  personsUrl: string
}

export default async function ActionItemsWidget({ workspaceId, personsUrl }: Props) {
  // Fetch recent interactions that have action items recorded
  const interactions = await db.interaction.findMany({
    where: {
      workspaceId,
      actionItems: { not: null },
    },
    orderBy: { timestamp: 'desc' },
    include: {
      person: { select: { id: true, first: true, last: true } },
      event: { select: { name: true } },
    },
    take: 10,
  })

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
    if (!interaction.actionItems) continue
    let items: string[] = []
    try {
      const parsed = JSON.parse(interaction.actionItems)
      items = Array.isArray(parsed) ? parsed : [String(parsed)]
    } catch {
      // plain text fallback
      items = [interaction.actionItems]
    }
    for (const item of items) {
      if (!item?.trim()) continue
      rows.push({
        id: `${interaction.id}-${rows.length}`,
        item: String(item).trim(),
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
        <h2 style={heading}>Action Items</h2>
        <a
          href={personsUrl}
          style={{ fontSize: '12px', color: '#a1a1aa', textDecoration: 'none' }}
        >
          Persons →
        </a>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#71717a' }}>
          No action items logged
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                borderLeft: '2px solid #3f3f46',
                paddingLeft: '12px',
                paddingTop: '6px',
                paddingBottom: '6px',
              }}
            >
              <div style={{ fontSize: '14px', lineHeight: 1.4 }}>{row.item}</div>
              <div style={{ fontSize: '12px', color: '#71717a', marginTop: '4px' }}>
                {row.personName ? (
                  <a
                    href={`${personsUrl}/people/${row.personId}`}
                    style={{ color: '#a1a1aa', textDecoration: 'none' }}
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
