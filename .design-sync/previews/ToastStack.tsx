import { ToastStack, Toast } from '@life-os/ui'
export const Stacked = () => (
  <div style={{ position: 'relative', width: 400, height: 160 }}>
    <ToastStack>
      <Toast message="Person saved." variant="success" />
      <Toast message="2 duplicates merged." variant="info" />
    </ToastStack>
  </div>
)
