import { Spinner } from '@life-os/ui'
export const Sizes = () => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
    <Spinner size={16} />
    <Spinner size={24} />
    <Spinner size={32} color="var(--cognac)" />
  </div>
)
