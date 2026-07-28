import { Textarea } from '@life-os/ui'

export const Basic = () => (
  <div style={{ width: 420 }}>
    <Textarea placeholder="Add a note about this person…" rows={3} />
  </div>
)

export const WithValueAndCounter = () => (
  <div style={{ width: 420 }}>
    <Textarea
      value="Kenji just started a new role at a climate startup — follow up in a month to hear how it's going."
      onChange={() => {}}
      maxChars={280}
      rows={3}
    />
  </div>
)
