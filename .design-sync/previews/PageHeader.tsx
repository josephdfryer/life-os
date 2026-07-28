import { PageHeader, Button } from '@life-os/ui'

export const Basic = () => (
  <div style={{ width: 640 }}>
    <PageHeader title="People" subtitle="248 relationships" />
  </div>
)

export const WithActions = () => (
  <div style={{ width: 640 }}>
    <PageHeader
      title="Kenji Lee"
      subtitle="Close friend · Oakland"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="ghost">Edit</Button>
          <Button size="sm" variant="primary">Log interaction</Button>
        </div>
      }
    />
  </div>
)
