import type { AdminCapabilities } from "@/lib/admin-access"

export function AdminOverview({ capabilities }: { capabilities: AdminCapabilities }) {
  return (
    <div className="stream-message" style={{ marginTop: 28 }}>
      <strong>Home is the administrative control plane.</strong>
      <p style={{ margin: "8px 0 18px" }}>Connections, system health, automation, and access controls live under Admin. Intelligence stays on its own page.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <a className="still-button still-button-secondary" href="/admin/connections">Manage connections</a>
        <a className="still-button still-button-secondary" href="/admin/health">Open system health</a>
        <a className="still-button still-button-secondary" href="/admin/stream">Open stream</a>
        {capabilities.automation && <a className="still-button still-button-secondary" href="/admin/automation">Open automation</a>}
        {capabilities.apiKeys && <a className="still-button still-button-secondary" href="/admin/api-keys">Manage API keys</a>}
        {capabilities.access && <a className="still-button still-button-secondary" href="/admin/access">Manage access</a>}
        {capabilities.assistantHistory && <a className="still-button still-button-secondary" href="/admin/assistant-chats">View Assistant chats</a>}
      </div>
    </div>
  )
}

export function WorkspacePanel({ workspace }: { workspace: { id: string; name: string; slug: string; status: string; createdAt: Date; updatedAt: Date; members: Array<{ id: string; role: string; user: { name: string | null; email: string } }> } | null }) {
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
        <div><span>Created</span><strong>{formatAdminDate(workspace.createdAt)}</strong></div>
        <div><span>Last updated</span><strong>{formatAdminDate(workspace.updatedAt)}</strong></div>
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

export function AuditTable({ rows }: { rows: Array<{ id: string; createdAt: Date; action: string; targetType: string; targetId: string | null; actorLabel: string | null }> }) {
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
              <time className="stream-row-date" dateTime={row.createdAt.toISOString()}>{formatAdminDate(row.createdAt)}</time>
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

export function formatAdminDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value)
}
