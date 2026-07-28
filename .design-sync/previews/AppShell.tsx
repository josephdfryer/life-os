import { AppShell, PageHeader, EntityRow, Badge, Avatar } from '@life-os/ui'
export const Basic = () => (
  <div style={{ width: 760, height: 420, overflow: 'hidden' }}>
    <AppShell
      appName="Persons"
      links={[
        { label: 'Today', href: '#', active: true },
        { label: 'People', href: '#' },
        { label: 'Inbox', href: '#' },
      ]}
      rightSlot={<Avatar name="Joseph Fryer" size="sm" />}
    >
      <div style={{ padding: '24px' }}>
        <PageHeader title="People" subtitle="248 relationships" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 16 }}>
          <EntityRow initials="KL" title="Kenji Lee" meta="Last seen 3 days ago" badges={<Badge label="Close" variant="accent" />} />
          <EntityRow initials="ED" title="Emily Ding" meta="Coworker · San Francisco" />
        </div>
      </div>
    </AppShell>
  </div>
)
