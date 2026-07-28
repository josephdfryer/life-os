import { SectionHeader, Button } from '@life-os/ui'
export const Basic = () => (
  <div style={{ width: 460 }}><SectionHeader label="Close friends" /></div>
)
export const WithAction = () => (
  <div style={{ width: 460 }}>
    <SectionHeader label="Upcoming plans" action={<Button size="sm" variant="ghost">See all</Button>} />
  </div>
)
