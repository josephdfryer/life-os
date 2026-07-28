import { Input } from '@life-os/ui'

export const Basic = () => (
  <Input placeholder="Search people…" />
)

export const WithValue = () => (
  <Input placeholder="Full name" defaultValue="Emily Ding" />
)

export const Clearable = () => (
  <Input placeholder="Filter by tag" value="oakland" onChange={() => {}} clearable onClear={() => {}} />
)
