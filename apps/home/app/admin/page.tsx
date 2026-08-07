import { Suspense } from 'react'
import { db } from '@life-os/db'
import { workspaceForHomeRequest } from '@/lib/request-access'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Admin · Life OS' }

export default function AdminPage(props: { searchParams: Promise<{ tab?: string }> }) {
  return <Suspense fallback={<AdminFallback />}><AdminContent {...props} /></Suspense>
}

async function AdminContent({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect('/login')
  const { tab = 'overview' } = await searchParams
  const [audit, workspace, calendar, gmail, roles, rules] = await Promise.all([
    tab === 'audit'
      ? db.auditLog.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, createdAt: true, action: true, targetType: true, targetId: true, actorLabel: true },
        })
      : Promise.resolve([]),
    tab === 'workspace'
      ? db.workspace.findUnique({
          where: { id: workspaceId },
          select: {
            id: true, name: true, slug: true, status: true, createdAt: true, updatedAt: true,
            members: { where: { status: 'active' }, orderBy: { createdAt: 'asc' }, take: 500, select: { id: true, role: true, user: { select: { name: true, email: true } } } },
          },
        })
      : Promise.resolve(null),
    tab === 'calendar'
      ? db.calendarConnection.findMany({ where: { workspaceId }, orderBy: { accountEmail: 'asc' }, take: 100, select: { id: true, accountEmail: true, status: true, calendarId: true, calendarSummary: true, lastSyncedAt: true, lastError: true } })
      : Promise.resolve([]),
    tab === 'gmail'
      ? db.gmailConnection.findMany({ where: { workspaceId }, orderBy: { accountEmail: 'asc' }, take: 100, select: { id: true, accountEmail: true, status: true, mailboxId: true, lastSyncedAt: true, lastError: true } })
      : Promise.resolve([]),
    tab === 'access'
      ? db.role.findMany({
          orderBy: { key: 'asc' },
          take: 100,
          select: {
            id: true, key: true, name: true, description: true,
            permissions: { take: 500, select: { permission: { select: { scope: true, description: true } } } },
          },
        })
      : Promise.resolve([]),
    tab === 'rules'
      ? db.rule.findMany({ where: { workspaceId }, orderBy: [{ status: 'asc' }, { priority: 'asc' }], take: 200, select: { id: true, name: true, description: true, trigger: true, status: true, mode: true, priority: true, conditions: true, actions: true, runs: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, status: true, matched: true } } } })
      : Promise.resolve([]),
  ])

  return (
    <main className="stream-page">
      <div className="stream-container">
        <p className="still-eyebrow">The control plane</p>
        <h1 className="stream-heading-title">Admin</h1>
        <p className="stream-intro">System-wide administration is moving into Home, one surface at a time.</p>
        <nav className="admin-tabs" aria-label="Admin tabs">
          {['overview', 'audit', 'workspace', 'calendar', 'gmail', 'access', 'rules'].map(value => <a key={value} className={tab === value ? 'admin-tab-active' : ''} href={`/admin?tab=${value}`}>{value === 'overview' ? 'Overview' : value === 'audit' ? 'Audit log' : value === 'workspace' ? 'Workspace' : value === 'calendar' ? 'Calendar' : value === 'gmail' ? 'Gmail' : value === 'access' ? 'Access' : 'Rules'}</a>)}
          <a className="admin-tab-legacy" href="https://persons.lacollecteur.com/admin">Legacy Persons admin ↗</a>
        </nav>
        {tab === 'audit' ? <AuditTable rows={audit} /> : tab === 'workspace' ? <WorkspacePanel workspace={workspace} /> : tab === 'calendar' ? <IntegrationPanel title="Calendar connections" rows={calendar.map(item => ({ ...item, detail: item.calendarSummary || item.calendarId }))} /> : tab === 'gmail' ? <IntegrationPanel title="Gmail connections" rows={gmail.map(item => ({ ...item, detail: item.mailboxId }))} /> : tab === 'access' ? <AccessPanel roles={roles} /> : tab === 'rules' ? <RulesPanel rules={rules} /> : <AdminOverview />}
      </div>
    </main>
  )
}

function AdminFallback() {
  return <main className="stream-page"><div className="stream-container"><p className="still-eyebrow">The control plane</p><h1 className="stream-heading-title">Admin</h1><div className="stream-message">Loading system records…</div></div></main>
}

function AdminOverview() {
  return <div className="stream-message" style={{ marginTop: 28 }}>
    <strong>Admin migration is in progress.</strong>
    <p style={{ margin: '8px 0 18px' }}>The audit log, workspace membership, connection health, and access map are now readable here. Automation has its own control-plane surface with authority and run history.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><a className="still-button still-button-secondary" href="/admin?tab=audit">View audit log</a><a className="still-button still-button-secondary" href="/automation">Open Automation</a></div>
  </div>
}

function WorkspacePanel({ workspace }: { workspace: { id: string; name: string; slug: string; status: string; createdAt: Date; updatedAt: Date; members: Array<{ id: string; role: string; user: { name: string | null; email: string } }> } | null }) {
  if (!workspace) return <div className="stream-message">Workspace not found.</div>
  return <section aria-labelledby="workspace-heading" style={{ marginTop: 28 }}>
    <div className="admin-section-heading"><div><p className="still-eyebrow">Workspace record</p><h2 id="workspace-heading">{workspace.name}</h2></div><span className="stream-count">{workspace.members.length} active members</span></div>
    <div className="admin-workspace-grid">
      <div><span>Slug</span><strong>{workspace.slug}</strong></div>
      <div><span>Status</span><strong>{workspace.status}</strong></div>
      <div><span>Created</span><strong>{formatDate(workspace.createdAt)}</strong></div>
      <div><span>Last updated</span><strong>{formatDate(workspace.updatedAt)}</strong></div>
    </div>
    <div className="stream-list admin-members">
      {workspace.members.map(member => <div className="admin-member-row" key={member.id}><div><strong>{member.user.name || member.user.email}</strong><span>{member.user.name ? member.user.email : 'Workspace member'}</span></div><span className="stream-type-badge">{member.role}</span></div>)}
    </div>
  </section>
}

function IntegrationPanel({ title, rows }: { title: string; rows: Array<{ id: string; accountEmail: string | null; status: string; detail: string; lastSyncedAt: Date | null; lastError: string | null }> }) {
  return <section aria-labelledby="integration-heading" style={{ marginTop: 28 }}>
    <div className="admin-section-heading"><div><p className="still-eyebrow">Connection health</p><h2 id="integration-heading">{title}</h2></div><span className="stream-count">{rows.length} connections</span></div>
    {rows.length === 0 ? <div className="stream-message">No connections configured.</div> : <div className="stream-list">
      {rows.map(row => <article className="admin-integration-row" key={row.id}><div><strong>{row.accountEmail || 'Unnamed account'}</strong><span>{row.detail}</span></div><div><span className={`integration-status integration-status-${row.status}`}>{row.status}</span><span>{row.lastError || (row.lastSyncedAt ? `Last synced ${formatDate(row.lastSyncedAt)}` : 'Not synced yet')}</span></div></article>)}
    </div>}
  </section>
}

function AccessPanel({ roles }: { roles: Array<{ id: string; key: string; name: string; description: string | null; permissions: Array<{ permission: { scope: string; description: string | null } }> }> }) {
  return <section aria-labelledby="access-heading" style={{ marginTop: 28 }}>
    <div className="admin-section-heading"><div><p className="still-eyebrow">Permission map</p><h2 id="access-heading">Roles and scopes</h2></div><span className="stream-count">{roles.length} roles</span></div>
    <div className="stream-list">{roles.map(role => <article className="admin-role-row" key={role.id}><div><strong>{role.name}</strong><span>{role.description || role.key}</span></div><div className="admin-scope-list">{role.permissions.map(({ permission }) => <span className="stream-type-badge" title={permission.description || undefined} key={permission.scope}>{permission.scope}</span>)}</div></article>)}</div>
  </section>
}

function RulesPanel({ rules }: { rules: Array<{ id: string; name: string; description: string | null; trigger: string; status: string; mode: string; priority: number; conditions: string; actions: string; runs: Array<{ createdAt: Date; status: string; matched: boolean }> }> }) {
  return <section aria-labelledby="rules-heading" style={{ marginTop: 28 }}>
    <div className="admin-section-heading"><div><p className="still-eyebrow">Automation</p><h2 id="rules-heading">Rules</h2></div><a className="still-button still-button-secondary" href="/automation">Open full Automation view</a></div>
    {rules.length === 0 ? <div className="stream-message">No rules configured for this workspace.</div> : <div className="stream-list">{rules.map(rule => <article className="admin-rule-row" key={rule.id}><div><strong>{rule.name}</strong><span>{rule.description || `${rule.trigger} · ${rule.mode}`}</span></div><div><span className={`integration-status integration-status-${rule.status}`}>{rule.status}</span><span>{rule.runs[0] ? `Last run ${rule.runs[0].status}${rule.runs[0].matched ? ' · matched' : ''}` : 'No runs yet'}</span></div></article>)}</div>}
  </section>
}

function AuditTable({ rows }: { rows: Array<{ id: string; createdAt: Date; action: string; targetType: string; targetId: string | null; actorLabel: string | null }> }) {
  return <section aria-labelledby="audit-heading" style={{ marginTop: 28 }}>
    <div className="admin-section-heading"><div><p className="still-eyebrow">System record</p><h2 id="audit-heading">Audit log</h2></div><span className="stream-count">{rows.length} recent entries</span></div>
    {rows.length === 0 ? <div className="stream-message">No audit entries in this workspace.</div> : <div className="stream-list">
      {rows.map(row => <article className="admin-audit-row" key={row.id}>
        <time className="stream-row-date" dateTime={row.createdAt.toISOString()}>{formatDate(row.createdAt)}</time>
        <div><div className="stream-row-title">{row.action}</div><div className="stream-row-detail">{row.targetType}{row.targetId ? ` · ${row.targetId}` : ''}</div></div>
        <span className="stream-row-detail">{row.actorLabel || 'System'}</span>
      </article>)}
    </div>}
  </section>
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}
