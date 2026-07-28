import { StillPage, SectionHeader, EntityRow, Badge } from '@life-os/ui'
export const WithSidebar = () => (
  <div style={{ width: 760, height: 360, overflow: 'hidden' }}>
    <StillPage
      sidebar={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--ink-3)' }}>
          <div style={{ color: 'var(--cognac-deep)', fontWeight: 500 }}>Today</div>
          <div>People</div>
          <div>Inbox</div>
          <div>Import</div>
        </div>
      }
    >
      <SectionHeader label="Needs attention" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>
        <EntityRow initials="QZ" title="Qin Zhao" meta="Birthday Friday" badges={<Badge label="Soon" variant="warning" />} />
        <EntityRow initials="KL" title="Kenji Lee" meta="Overdue by 2 weeks" />
      </div>
    </StillPage>
  </div>
)
