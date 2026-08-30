import { Suspense } from "react"
import { db } from "@life-os/db"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { redirect } from "next/navigation"
import { AccessControls, ApiKeyControls, ApprovedEmailControls, WorkspacesControls } from "./AdminControls"
import { AdminChrome, AdminFallback } from "./AdminChrome"

export const metadata = { title: "Admin · LifeOS" }

export default function AdminPage(props: { searchParams: Promise<{ tab?: string }> }) {
  return <Suspense fallback={<AdminFallback />}><AdminContent {...props} /></Suspense>
}

async function AdminContent({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")
  const { tab = "overview" } = await searchParams
  if (tab === "system" || tab === "health" || tab === "streams") redirect("/admin/health")
  if (tab === "stream") redirect("/admin/stream")

  const [audit, workspace, roles, permissions, apiKeys, approvedEmails, allWorkspaces] = await Promise.all([
    tab === "audit"
      ? db.auditLog.findMany({
          where: { workspaceId },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, createdAt: true, action: true, targetType: true, targetId: true, actorLabel: true },
        })
      : Promise.resolve([]),
    tab === "workspace" || tab === "access"
      ? db.workspace.findUnique({
          where: { id: workspaceId },
          select: {
            id: true, name: true, slug: true, status: true, createdAt: true, updatedAt: true,
            members: { where: { status: "active" }, orderBy: { createdAt: "asc" }, take: 500, select: { id: true, role: true, user: { select: { id: true, name: true, email: true, roles: { take: 100, select: { role: { select: { id: true, name: true } } } } } } } },
          },
        })
      : Promise.resolve(null),
    tab === "access"
      ? db.role.findMany({
          orderBy: { key: "asc" },
          take: 100,
          select: {
            id: true, key: true, name: true, description: true,
            permissions: { take: 500, select: { permission: { select: { id: true, scope: true, description: true } } } },
            _count: { select: { users: true } },
          },
        })
      : Promise.resolve([]),
    tab === "access" || tab === "api-keys"
      ? db.permission.findMany({ orderBy: { scope: "asc" }, take: 500, select: { id: true, scope: true, description: true } })
      : Promise.resolve([]),
    tab === "api-keys"
      ? db.apiKey.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, name: true, keyPrefix: true, status: true, lastUsedAt: true, scopes: { take: 500, select: { scope: true } } } })
      : Promise.resolve([]),
    tab === "workspace"
      ? db.approvedEmail.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 500, select: { id: true, email: true, status: true, createdAt: true } })
      : Promise.resolve([]),
    // Cross-tenant view: only the instance owner's own primary workspace is
    // literally "default-workspace" (see packages/access/index.ts's
    // buildWorkspace) — every other workspace's owner has full
    // settings.manage scope inside its own workspace, so this gate must be
    // "is this literally the default workspace", not a scope check.
    tab === "workspace" && workspaceId === "default-workspace"
      ? db.workspace.findMany({
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            id: true, name: true, slug: true, status: true, createdAt: true,
            ownerUser: { select: { email: true } },
            _count: { select: { members: true, approvedEmails: true } },
          },
        })
      : Promise.resolve([]),
  ])

  const accessUsers = tab === "access"
    ? workspace?.members.map(member => ({ id: member.user.id, email: member.user.email, name: member.user.name, roles: member.user.roles.map(item => item.role) })) ?? []
    : []

  return (
    <AdminChrome tab={tab === "api-keys" || tab === "access" || tab === "workspace" || tab === "audit" ? tab : "overview"}>
      {tab === "audit" ? <AuditTable rows={audit} />
        : tab === "workspace" ? <>
            <WorkspacePanel workspace={workspace} />
            <ApprovedEmailControls rows={approvedEmails.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }))} />
            {workspaceId === "default-workspace" && <WorkspacesControls rows={allWorkspaces.map(row => ({
              id: row.id, name: row.name, slug: row.slug, status: row.status, createdAt: row.createdAt.toISOString(),
              ownerEmail: row.ownerUser?.email ?? null, memberCount: row._count.members, approvedEmailCount: row._count.approvedEmails,
              isDefault: row.id === "default-workspace",
            }))} />}
          </>
        : tab === "access" ? <AccessControls roles={roles.map(role => ({ ...role, permissions: role.permissions.map(item => item.permission), userCount: role._count.users }))} users={accessUsers} permissions={permissions} />
        : tab === "api-keys" ? <ApiKeyControls apiKeys={apiKeys.map(key => ({ ...key, lastUsedAt: key.lastUsedAt?.toISOString() ?? null, scopes: key.scopes.map(scope => scope.scope) }))} permissions={permissions} />
        : <AdminOverview />}
    </AdminChrome>
  )
}

function AdminOverview() {
  return (
    <div className="stream-message" style={{ marginTop: 28 }}>
      <strong>Home is the administrative control plane.</strong>
      <p style={{ margin: "8px 0 18px" }}>System health lists every stream, when it last gave data, and the event spine. Access and credentials stay on these tabs.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <a className="still-button still-button-secondary" href="/admin/stream">Open stream</a>
        <a className="still-button still-button-secondary" href="/admin/health">Open system health</a>
        <a className="still-button still-button-secondary" href="/admin?tab=api-keys">Manage API keys</a>
        <a className="still-button still-button-secondary" href="/connections">Manage accounts</a>
        <a className="still-button still-button-secondary" href="/automation">Open Automation</a>
      </div>
    </div>
  )
}

function WorkspacePanel({ workspace }: { workspace: { id: string; name: string; slug: string; status: string; createdAt: Date; updatedAt: Date; members: Array<{ id: string; role: string; user: { name: string | null; email: string } }> } | null }) {
  if (!workspace) return <div className="stream-message">Workspace not found.</div>
  return (
    <section aria-labelledby="workspace-heading" style={{ marginTop: 28 }}>
      <div className="admin-section-heading">
        <div>
          <p className="still-eyebrow">Workspace record</p>
          <h2 id="workspace-heading">{workspace.name}</h2>
        </div>
        <span className="stream-count">{workspace.members.length} active members</span>
      </div>
      <div className="admin-workspace-grid">
        <div><span>Slug</span><strong>{workspace.slug}</strong></div>
        <div><span>Status</span><strong>{workspace.status}</strong></div>
        <div><span>Created</span><strong>{formatDate(workspace.createdAt)}</strong></div>
        <div><span>Last updated</span><strong>{formatDate(workspace.updatedAt)}</strong></div>
      </div>
      <div className="stream-list admin-members">
        {workspace.members.map(member => (
          <div className="admin-member-row" key={member.id}>
            <div>
              <strong>{member.user.name || member.user.email}</strong>
              <span>{member.user.name ? member.user.email : "Workspace member"}</span>
            </div>
            <span className="stream-type-badge">{member.role}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function AuditTable({ rows }: { rows: Array<{ id: string; createdAt: Date; action: string; targetType: string; targetId: string | null; actorLabel: string | null }> }) {
  return (
    <section aria-labelledby="audit-heading" style={{ marginTop: 28 }}>
      <div className="admin-section-heading">
        <div>
          <p className="still-eyebrow">System record</p>
          <h2 id="audit-heading">Audit log</h2>
        </div>
        <span className="stream-count">{rows.length} recent entries</span>
      </div>
      {rows.length === 0 ? <div className="stream-message">No audit entries in this workspace.</div> : (
        <div className="stream-list">
          {rows.map(row => (
            <article className="admin-audit-row" key={row.id}>
              <time className="stream-row-date" dateTime={row.createdAt.toISOString()}>{formatDate(row.createdAt)}</time>
              <div>
                <div className="stream-row-title">{row.action}</div>
                <div className="stream-row-detail">{row.targetType}{row.targetId ? ` · ${row.targetId}` : ""}</div>
              </div>
              <span className="stream-row-detail">{row.actorLabel || "System"}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value)
}
