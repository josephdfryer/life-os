import { Suspense } from 'react'
import { db } from '@life-os/db'
import { workspaceForHomeRequest } from '@/lib/request-access'
import { redirect } from 'next/navigation'
import { AccessControls, ApiKeyControls, ApprovedEmailControls, WorkspacesControls } from './AdminControls'

export const metadata = { title: 'Admin · Life OS' }

export default function AdminPage(props: { searchParams: Promise<{ tab?: string }> }) {
  return <Suspense fallback={<AdminFallback />}><AdminContent {...props} /></Suspense>
}

async function AdminContent({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect('/login')
  const { tab = 'overview' } = await searchParams
  const [audit, workspace, roles, permissions, apiKeys, approvedEmails, systemHealth, allWorkspaces] = await Promise.all([
    tab === 'audit'
      ? db.auditLog.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, createdAt: true, action: true, targetType: true, targetId: true, actorLabel: true },
        })
      : Promise.resolve([]),
    tab === 'workspace' || tab === 'access'
      ? db.workspace.findUnique({
          where: { id: workspaceId },
          select: {
            id: true, name: true, slug: true, status: true, createdAt: true, updatedAt: true,
            members: { where: { status: 'active' }, orderBy: { createdAt: 'asc' }, take: 500, select: { id: true, role: true, user: { select: { id: true, name: true, email: true, roles: { take: 100, select: { role: { select: { id: true, name: true } } } } } } } },
          },
        })
      : Promise.resolve(null),
    tab === 'access'
      ? db.role.findMany({
          orderBy: { key: 'asc' },
          take: 100,
          select: {
            id: true, key: true, name: true, description: true,
            permissions: { take: 500, select: { permission: { select: { id: true, scope: true, description: true } } } },
            _count: { select: { users: true } },
          },
        })
      : Promise.resolve([]),
    tab === 'access' || tab === 'api-keys'
      ? db.permission.findMany({ orderBy: { scope: 'asc' }, take: 500, select: { id: true, scope: true, description: true } })
      : Promise.resolve([]),
    tab === 'api-keys'
      ? db.apiKey.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, name: true, keyPrefix: true, status: true, lastUsedAt: true, scopes: { take: 500, select: { scope: true } } } })
      : Promise.resolve([]),
    tab === 'workspace'
      ? db.approvedEmail.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, email: true, status: true, createdAt: true } })
      : Promise.resolve([]),
    tab === 'system' ? loadSystemHealth(workspaceId) : Promise.resolve(null),
    // Cross-tenant view: only the instance owner's own primary workspace is
    // literally "default-workspace" (see packages/access/index.ts's
    // buildWorkspace) — every other workspace's owner has full
    // settings.manage scope inside its own workspace, so this gate must be
    // "is this literally the default workspace", not a scope check.
    tab === 'workspace' && workspaceId === 'default-workspace'
      ? db.workspace.findMany({
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true, name: true, slug: true, status: true, createdAt: true,
            ownerUser: { select: { email: true } },
            _count: { select: { members: true, approvedEmails: true } },
          },
        })
      : Promise.resolve([]),
  ])

  const accessUsers = tab === 'access'
    ? workspace?.members.map(member => ({ id: member.user.id, email: member.user.email, name: member.user.name, roles: member.user.roles.map(item => item.role) })) ?? []
    : []

  return (
    <main className="stream-page">
      <div className="stream-container">
        <p className="still-eyebrow">The control plane</p>
        <h1 className="stream-heading-title">Admin</h1>
        <p className="stream-intro">System-wide access, credentials, and audit controls live here.</p>
        <nav className="admin-tabs" aria-label="Admin tabs">
          {Object.entries(ADMIN_TABS).map(([value, label]) => <a key={value} className={tab === value ? 'admin-tab-active' : ''} href={`/admin?tab=${value}`}>{label}</a>)}
        </nav>
        {tab === 'audit' ? <AuditTable rows={audit} />
          : tab === 'workspace' ? <>
              <WorkspacePanel workspace={workspace} />
              <ApprovedEmailControls rows={approvedEmails.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }))} />
              {workspaceId === 'default-workspace' && <WorkspacesControls rows={allWorkspaces.map(row => ({
                id: row.id, name: row.name, slug: row.slug, status: row.status, createdAt: row.createdAt.toISOString(),
                ownerEmail: row.ownerUser?.email ?? null, memberCount: row._count.members, approvedEmailCount: row._count.approvedEmails,
                isDefault: row.id === 'default-workspace',
              }))} />}
            </>
          : tab === 'access' ? <AccessControls roles={roles.map(role => ({ ...role, permissions: role.permissions.map(item => item.permission), userCount: role._count.users }))} users={accessUsers} permissions={permissions} />
          : tab === 'api-keys' ? <ApiKeyControls apiKeys={apiKeys.map(key => ({ ...key, lastUsedAt: key.lastUsedAt?.toISOString() ?? null, scopes: key.scopes.map(scope => scope.scope) }))} permissions={permissions} />
          : tab === 'system' && systemHealth ? <SystemHealthPanel health={systemHealth} />
          : <AdminOverview />}
      </div>
    </main>
  )
}

function AdminFallback() {
  return <main className="stream-page"><div className="stream-container"><p className="still-eyebrow">The control plane</p><h1 className="stream-heading-title">Admin</h1><div className="stream-message">Loading system records…</div></div></main>
}

function AdminOverview() {
  return <div className="stream-message" style={{ marginTop: 28 }}>
    <strong>Home is the administrative control plane.</strong>
    <p style={{ margin: '8px 0 18px' }}>Manage API keys, access roles, workspace sign-ins, and system history here. Connections and Automation each have a focused Home surface.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><a className="still-button still-button-secondary" href="/admin?tab=api-keys">Manage API keys</a><a className="still-button still-button-secondary" href="/connections">Open Connections</a><a className="still-button still-button-secondary" href="/automation">Open Automation</a></div>
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

type SystemHealth = Awaited<ReturnType<typeof loadSystemHealth>>

async function loadSystemHealth(workspaceId: string) {
  const [eventCount, recentEvents, receiptGroups, oldestPendingReceipt, pendingReviews, failedReviews, failedRuleRuns, calendarIssues, gmailIssues] = await Promise.all([
    db.graphEvent.count({ where: { workspaceId } }),
    db.graphEvent.findMany({
      where: { workspaceId },
      orderBy: { recordedAt: 'desc' },
      take: 12,
      select: {
        id: true, eventType: true, subjectType: true, subjectId: true, recordedAt: true, sourceConnector: true,
        receipts: { take: 10, orderBy: { createdAt: 'asc' }, select: { id: true, consumer: true, status: true, attempts: true, lastError: true, nextRetryAt: true, processedAt: true } },
      },
    }),
    db.graphEventReceipt.groupBy({ by: ['status'], where: { event: { workspaceId } }, _count: { _all: true } }),
    db.graphEventReceipt.findFirst({ where: { event: { workspaceId }, status: { in: ['pending', 'processing', 'failed'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    db.reviewItem.count({ where: { workspaceId, status: 'pending' } }),
    db.reviewItem.count({ where: { workspaceId, status: 'failed' } }),
    db.ruleRun.count({ where: { workspaceId, status: { in: ['failed', 'error'] } } }),
    db.calendarConnection.count({ where: { workspaceId, OR: [{ lastError: { not: null } }, { status: { not: 'active' } }] } }),
    db.gmailConnection.count({ where: { workspaceId, OR: [{ lastError: { not: null } }, { status: { not: 'active' } }] } }),
  ])
  const receipts = Object.fromEntries(receiptGroups.map(group => [group.status, group._count._all]))
  const receiptCount = Object.values(receipts).reduce((sum, count) => sum + count, 0)
  return {
    eventCount,
    recentEvents,
    receiptCount,
    receipts,
    oldestPendingAt: oldestPendingReceipt?.createdAt ?? null,
    pendingReviews,
    failedReviews,
    failedRuleRuns,
    connectorIssues: calendarIssues + gmailIssues,
  }
}

function SystemHealthPanel({ health }: { health: SystemHealth }) {
  const failedReceipts = health.receipts.failed ?? 0
  const waitingReceipts = (health.receipts.pending ?? 0) + (health.receipts.processing ?? 0)
  const state = failedReceipts || health.failedReviews || health.failedRuleRuns || health.connectorIssues
    ? { label: 'Needs attention', className: 'system-state-attention', detail: 'At least one durable process or connection has reported a failure.' }
    : health.eventCount === 0
      ? { label: 'Not yet exercised', className: 'system-state-idle', detail: 'The spine is ready, but no canonical GraphEvents have been published yet.' }
      : health.receiptCount === 0
        ? { label: 'No consumer receipts', className: 'system-state-attention', detail: 'Events exist, but no consumer has reported processing them.' }
        : { label: 'Operational', className: 'system-state-healthy', detail: waitingReceipts ? 'Consumers are working through the durable queue.' : 'Published events have no visible backlog.' }

  return <section className="system-health" aria-labelledby="system-health-heading">
    <div className={`system-health-state ${state.className}`}>
      <div><p className="still-eyebrow">Event spine</p><h2 id="system-health-heading">{state.label}</h2><p>{state.detail}</p></div>
      <div><span>Queue age</span><strong>{health.oldestPendingAt ? formatAge(health.oldestPendingAt) : 'No backlog'}</strong></div>
    </div>
    <div className="system-health-metrics" aria-label="System health metrics">
      <HealthMetric label="GraphEvents" value={health.eventCount} detail={health.recentEvents[0] ? `Latest ${formatAge(health.recentEvents[0].recordedAt)}` : 'Awaiting first event'} />
      <HealthMetric label="Receipts" value={health.receiptCount} detail={`${health.receipts.done ?? 0} done · ${waitingReceipts} waiting · ${failedReceipts} failed`} attention={failedReceipts > 0} />
      <HealthMetric label="Inbox" value={health.pendingReviews} detail={`${health.failedReviews} failed review items`} attention={health.failedReviews > 0} />
      <HealthMetric label="Connections" value={health.connectorIssues} detail="Calendar and Gmail issues" attention={health.connectorIssues > 0} />
    </div>
    <div className="admin-section-heading"><div><p className="still-eyebrow">Recent activity</p><h2>Canonical events</h2></div><span className="stream-count">{health.recentEvents.length} shown</span></div>
    {health.recentEvents.length === 0 ? <div className="stream-message">No GraphEvents recorded. The first shared command that publishes one will appear here with its consumer receipts.</div> : <div className="stream-list">
      {health.recentEvents.map(event => <article className="system-event-row" key={event.id}>
        <time dateTime={event.recordedAt.toISOString()}>{formatDate(event.recordedAt)}</time>
        <div><strong>{event.eventType}</strong><span>{event.subjectType} · {event.sourceConnector || 'canonical command'}</span></div>
        <div>{event.receipts.length === 0 ? <span className="system-receipt system-receipt-missing">No receipts</span> : event.receipts.map(receipt => <span className={`system-receipt system-receipt-${receipt.status}`} title={receipt.lastError || undefined} key={receipt.id}>{receipt.consumer} · {receipt.status} · {receipt.attempts}</span>)}</div>
      </article>)}
    </div>}
  </section>
}

function HealthMetric({ label, value, detail, attention = false }: { label: string; value: number; detail: string; attention?: boolean }) {
  return <div className={attention ? 'system-health-metric system-health-metric-attention' : 'system-health-metric'}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
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

function formatAge(value: Date) {
  const elapsed = Math.max(0, Date.now() - value.getTime())
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const ADMIN_TABS = {
  overview: 'Overview',
  'api-keys': 'API keys',
  access: 'Access',
  workspace: 'Workspace',
  system: 'System Health',
  audit: 'Audit log',
} as const
