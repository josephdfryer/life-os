import { ProgressBar } from '@life-os/ui'

export const Levels = () => (
  <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
    <ProgressBar value={25} />
    <ProgressBar value={60} />
    <ProgressBar value={92} color="var(--petrol)" />
  </div>
)
