import { Badge } from '@life-os/ui'

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <Badge label="Default" />
    <Badge label="Close friend" variant="accent" />
    <Badge label="Confirmed" variant="success" />
    <Badge label="Overdue" variant="warning" />
    <Badge label="Archived" variant="muted" />
  </div>
)
