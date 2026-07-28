import { Card, Button, Badge } from '@life-os/ui'

export const Basic = () => (
  <Card title="Kenji Lee">
    <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
      Close friend · last seen 3 days ago<br />
      Met at the Oakland co-working space in 2019.
    </div>
  </Card>
)

export const WithHeaderActionAndFooter = () => (
  <Card
    title="Dinner with Qin"
    headerAction={<Badge label="Active" variant="success" />}
    footer={
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" variant="primary">Confirm</Button>
        <Button size="sm" variant="ghost">Snooze</Button>
      </div>
    }
  >
    <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
      Friday, 7:30pm at Nari. You suggested trying the coconut curry.
    </div>
  </Card>
)
