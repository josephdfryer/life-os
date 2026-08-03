import { TimezonePicker } from '@life-os/ui'

// The master timezone control. Only the resting state renders statically — the
// input/Save/Cancel state is behind internal `editing` state with no prop to
// force it, so it can't be a story.

export const Default = () => <TimezonePicker current="America/Los_Angeles" />

export const CustomLabel = () => (
  <TimezonePicker current="Europe/London" label="Master timezone" />
)
