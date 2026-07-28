import { TopNav, Avatar } from '@life-os/ui'
export const Basic = () => (
  <div style={{ width: 720 }}>
    <TopNav
      appName="Persons"
      links={[
        { label: 'Today', href: '#', active: true },
        { label: 'People', href: '#' },
        { label: 'Inbox', href: '#' },
        { label: 'Import', href: '#' },
      ]}
      rightSlot={<Avatar name="Joseph Fryer" size="sm" />}
    />
  </div>
)
