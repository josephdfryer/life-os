import { Button } from '@life-os/ui'

export const Variants = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button variant="primary">Save person</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="danger">Delete</Button>
  </div>
)

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button size="sm" variant="primary">Small</Button>
    <Button size="md" variant="primary">Medium</Button>
  </div>
)

export const States = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button variant="primary" loading>Saving…</Button>
    <Button variant="ghost" disabled>Disabled</Button>
  </div>
)
