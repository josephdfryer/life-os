import { Chip } from '@life-os/ui'

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <Chip label="Family" />
    <Chip label="Oakland" variant="accent" />
    <Chip label="Coworker" variant="removable" onRemove={() => {}} />
  </div>
)
