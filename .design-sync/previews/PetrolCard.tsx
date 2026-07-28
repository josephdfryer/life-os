import { PetrolCard, Button } from '@life-os/ui'
export const Basic = () => (
  <div style={{ width: 420 }}>
    <PetrolCard eyebrow="This week" title="You saw 12 people">
      <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.9 }}>
        Three more than last week. Kenji and Emily are due for a check-in.
      </div>
    </PetrolCard>
  </div>
)
export const WithAction = () => (
  <div style={{ width: 420 }}>
    <PetrolCard
      eyebrow="Nudge"
      title="Qin's birthday is Friday"
      action={<Button size="sm" variant="ghost">Plan something</Button>}
    >
      <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.9 }}>
        You usually get dinner. Nari had that coconut curry you both liked.
      </div>
    </PetrolCard>
  </div>
)
