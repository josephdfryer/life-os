import { EmptyState, Button } from '@life-os/ui'
export const Basic = () => (
  <div style={{ width: 460 }}>
    <EmptyState icon="○" title="No people yet" subtitle="Add someone to start tracking your relationships." />
  </div>
)
export const WithAction = () => (
  <div style={{ width: 460 }}>
    <EmptyState
      icon="◇"
      title="Nothing overdue"
      subtitle="You're caught up with everyone you care about."
      action={<Button size="sm" variant="primary">Add a person</Button>}
    />
  </div>
)
