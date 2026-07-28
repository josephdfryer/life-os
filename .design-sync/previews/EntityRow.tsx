import { EntityRow, Badge } from '@life-os/ui'

export const Basic = () => (
  <div style={{ width: 420 }}>
    <EntityRow initials="KL" title="Kenji Lee" meta="Last seen 3 days ago" />
  </div>
)

export const WithBadges = () => (
  <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 4 }}>
    <EntityRow
      initials="ED"
      title="Emily Ding"
      meta="Coworker · San Francisco"
      badges={<Badge label="Close" variant="accent" />}
    />
    <EntityRow
      initials="QZ"
      title="Qin Zhao"
      meta="Friend · last seen today"
      badges={<Badge label="Confirmed" variant="success" />}
    />
  </div>
)
