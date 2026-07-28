import { Select } from '@life-os/ui'
export const Basic = () => (
  <div style={{ width: 260 }}>
    <Select defaultValue="close">
      <option value="acquaintance">Acquaintance</option>
      <option value="friend">Friend</option>
      <option value="close">Close friend</option>
      <option value="family">Family</option>
    </Select>
  </div>
)
