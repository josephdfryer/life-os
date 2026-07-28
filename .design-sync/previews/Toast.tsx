import { Toast } from '@life-os/ui'
export const Variants = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 360 }}>
    <Toast message="Interaction logged with Kenji." variant="success" />
    <Toast message="Couldn't reach Google Calendar." variant="error" />
    <Toast message="Syncing your contacts…" variant="info" />
  </div>
)
