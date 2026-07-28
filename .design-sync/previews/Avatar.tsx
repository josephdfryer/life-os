import { Avatar } from '@life-os/ui'

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar name="Kenji Lee" size="sm" />
    <Avatar name="Emily Ding" size="md" />
    <Avatar name="Qin Zhao" size="lg" />
  </div>
)

export const Colored = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar name="Ada Okafor" size="md" color="var(--cognac)" textColor="#fff" />
    <Avatar name="Bruno Sato" size="md" color="var(--petrol)" textColor="#fff" />
    <Avatar name="Cleo Marín" size="md" color="var(--camel)" textColor="#fff" />
  </div>
)
