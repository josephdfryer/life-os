import { StatBlock } from '@life-os/ui'

export const Row = () => (
  <div style={{ display: 'flex', gap: 32, alignItems: 'flex-end' }}>
    <StatBlock label="People" value={248} />
    <StatBlock label="Seen this week" value={12} accent />
    <StatBlock label="Overdue" value={5} large />
  </div>
)
