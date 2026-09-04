"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"

export type Permission = { id: string; scope: string; description: string | null }
export type Role = { id: string; key: string; name: string; description: string | null; permissions: Permission[]; userCount: number }
export type AdminUser = { id: string; email: string; name: string | null; isWorkspaceOwner: boolean; roles: { id: string; name: string }[] }
export type ApiKey = { id: string; name: string; keyPrefix: string; status: string; scopes: string[]; lastUsedAt: string | null }
export type InviteRole = { id: string; key: string; name: string; description: string | null }
export type ApprovedEmail = { id: string; email: string; status: string; workspaceId: string | null; createdAt: string; role: InviteRole | null }
export type WorkspaceRow = { id: string; name: string; slug: string; status: string; createdAt: string; ownerEmail: string | null; memberCount: number; approvedEmailCount: number; isDefault: boolean }

export function ApiKeyControls({ apiKeys, permissions }: { apiKeys: ApiKey[]; permissions: Permission[] }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState<string[]>(["people.read", "interactions.read"])
  const [secret, setSecret] = useState<string | null>(null)
  const mutation = useAdminMutation(router.refresh)

  async function createKey() {
    const result = await mutation.run<{ secret: string }>("/api/admin/api-keys", "POST", { name, scopes })
    if (result) { setSecret(result.secret); setName("") }
  }

  return <AdminGrid aside={
    <AdminCard title="New API key">
      <Field label="Name" value={name} onChange={setName} placeholder="Calendar importer" />
      <ScopePicker permissions={permissions} selected={scopes} onToggle={scope => setScopes(toggle(scopes, scope))} />
      <MutationButton disabled={!name.trim() || scopes.length === 0} mutation={mutation} onClick={createKey}>Create key</MutationButton>
      {secret && <div className="admin-secret" role="status"><strong>Copy this secret now</strong><code>{secret}</code><span>It will not be shown again.</span></div>}
    </AdminCard>
  }>
    <AdminCard title="API keys" meta={`${apiKeys.length} keys`}>
      {apiKeys.length === 0 ? <Empty>No API keys yet.</Empty> : <div className="admin-control-list">{apiKeys.map(key =>
        <div className="admin-control-row" key={key.id}><div><strong>{key.name}</strong><span>{key.keyPrefix} · {key.scopes.join(", ")}</span></div><div><span className="stream-type-badge">{key.status}</span><button className="still-button still-button-secondary" disabled={mutation.busy} onClick={() => mutation.run(`/api/admin/api-keys/${key.id}`, "PATCH", { status: key.status === "active" ? "revoked" : "active" })}>{key.status === "active" ? "Revoke" : "Activate"}</button></div></div>
      )}</div>}
    </AdminCard>
    <MutationMessage mutation={mutation} />
  </AdminGrid>
}

export function AccessControls({ roles, users, permissions }: { roles: Role[]; users: AdminUser[]; permissions: Permission[] }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? "")
  const selected = roles.find(role => role.id === selectedId) ?? roles[0] ?? null
  const [scopeDrafts, setScopeDrafts] = useState<Record<string, string[]>>({})
  const [userDrafts, setUserDrafts] = useState<Record<string, string[]>>({})
  const [newRole, setNewRole] = useState({ key: "", name: "", description: "" })
  const mutation = useAdminMutation(router.refresh)
  const selectedScopes = selected ? scopeDrafts[selected.id] ?? selected.permissions.map(permission => permission.scope) : []

  return <div className="admin-access-grid">
    <AdminCard title="Roles" meta={`${roles.length} roles`}><div className="admin-role-picker">{roles.map(role => <button className={role.id === selected?.id ? "admin-role-choice admin-role-choice-active" : "admin-role-choice"} key={role.id} onClick={() => setSelectedId(role.id)}><strong>{role.name}</strong><span>{role.key} · {role.userCount} users</span></button>)}</div></AdminCard>
    <AdminCard title={selected?.name ?? "Role permissions"} meta={selected?.key}>{selected && (selected.key === "owner" ? <p className="admin-control-help">Owner is an immutable system role reserved for the workspace owner.</p> : <><ScopePicker permissions={permissions} selected={selectedScopes} onToggle={scope => setScopeDrafts(current => ({ ...current, [selected.id]: toggle(selectedScopes, scope) }))} /><MutationButton mutation={mutation} onClick={() => mutation.run(`/api/admin/roles/${selected.id}`, "PATCH", { scopes: selectedScopes })}>Save role</MutationButton></>)}</AdminCard>
    <AdminCard title="New role"><Field label="Key" value={newRole.key} onChange={key => setNewRole(value => ({ ...value, key }))} placeholder="partner" /><Field label="Name" value={newRole.name} onChange={name => setNewRole(value => ({ ...value, name }))} placeholder="Partner" /><Field label="Description" value={newRole.description} onChange={description => setNewRole(value => ({ ...value, description }))} placeholder="External collaborator" /><MutationButton disabled={!newRole.key.trim() || !newRole.name.trim()} mutation={mutation} onClick={() => mutation.run("/api/admin/roles", "POST", { ...newRole, scopes: [] })}>Create role</MutationButton></AdminCard>
    <AdminCard title="User access" meta={`${users.length} users`}><div className="admin-control-list">{users.map(user => { const assigned = userDrafts[user.id] ?? user.roles.map(role => role.id); return <div className="admin-user-access" key={user.id}><strong>{user.name || user.email}</strong><span>{user.name ? `${user.email}${user.isWorkspaceOwner ? " · Workspace owner" : ""}` : user.isWorkspaceOwner ? "Workspace owner" : "Workspace member"}</span><div>{roles.map(role => { const ownerRole = role.key === "owner"; const hasRole = assigned.includes(role.id); return <label key={role.id}><input type="checkbox" checked={hasRole} disabled={ownerRole && (user.isWorkspaceOwner || !hasRole)} onChange={() => setUserDrafts(current => ({ ...current, [user.id]: toggle(assigned, role.id) }))} />{role.name}</label> })}</div><button className="still-button still-button-secondary" disabled={mutation.busy} onClick={() => mutation.run(`/api/admin/users/${user.id}/roles`, "PATCH", { roleIds: assigned })}>Save access</button></div> })}</div></AdminCard>
    <MutationMessage mutation={mutation} />
  </div>
}

export function ApprovedEmailControls({ rows, roles }: { rows: ApprovedEmail[]; roles: InviteRole[] }) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [standalone, setStandalone] = useState(false)
  const [roleId, setRoleId] = useState(roles.find(role => role.key === "viewer")?.id ?? roles[0]?.id ?? "")
  const mutation = useAdminMutation(router.refresh)
  return <AdminGrid aside={<AdminCard title="Approve an email">
    <Field label="Email" value={email} onChange={setEmail} placeholder="name@example.com" />
    {!standalone && <label className="admin-control-field"><span>Starting role</span><select value={roleId} onChange={event => setRoleId(event.target.value)}>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>}
    <label className="admin-control-checkbox"><input type="checkbox" checked={standalone} onChange={event => setStandalone(event.target.checked)} /> Give this person their own standalone workspace</label>
    <p className="admin-control-help">{standalone ? "They get a brand-new, fully isolated workspace as its Owner on first sign-in — no access to your data." : `${roles.find(role => role.id === roleId)?.description ?? "The selected role applies from their first sign-in."} You can promote them later under Access. Workspace admins can review member Assistant chats.`}</p>
    <MutationButton disabled={!email.trim() || (!standalone && !roleId)} mutation={mutation} onClick={async () => { const result = await mutation.run("/api/admin/approved-emails", "POST", { email, ...(standalone ? { workspaceId: null } : { roleId }) }); if (result) { setEmail(""); setStandalone(false) } }}>Approve email</MutationButton>
  </AdminCard>}>
    <AdminCard title="Approved emails" meta={`${rows.length} addresses`}><div className="admin-control-list">{rows.map(row => <div className="admin-control-row" key={row.id}><div><strong>{row.email}</strong><span>{row.role?.name ?? (row.workspaceId ? "Viewer" : "Owner of standalone workspace")} · Approved {formatDate(row.createdAt)}</span></div><div><span className="stream-type-badge">{row.status}</span><button className="still-button still-button-secondary" disabled={mutation.busy} onClick={() => mutation.run(`/api/admin/approved-emails/${row.id}`, "PATCH", { status: row.status === "approved" ? "revoked" : "approved" })}>{row.status === "approved" ? "Revoke" : "Re-approve"}</button></div></div>)}</div></AdminCard><MutationMessage mutation={mutation} />
  </AdminGrid>
}

// Only rendered when the signed-in admin's own workspace is literally
// "default-workspace" (the instance owner) — see apps/home/app/admin/page.tsx.
// Every other workspace's owner has full settings.manage scope inside its
// own workspace, so that check has to happen before this component ever
// renders, not just at the API layer.
export function WorkspacesControls({ rows }: { rows: WorkspaceRow[] }) {
  const router = useRouter()
  const mutation = useAdminMutation(router.refresh)
  const standalone = rows.filter(row => !row.isDefault)
  return <AdminCard title="Workspaces" meta={`${standalone.length} standalone`}>
    <p className="admin-control-help">Every workspace on this instance, including yours. Suspending blocks future sign-in for everyone in that workspace — it does not end an already-signed-in session.</p>
    <div className="admin-control-list">
      {rows.map(row => <div className="admin-control-row" key={row.id}>
        <div>
          <strong>{row.name}{row.isDefault ? " (yours)" : ""}</strong>
          <span>{row.ownerEmail ?? "no owner"} · {row.memberCount} member{row.memberCount === 1 ? "" : "s"} · {row.approvedEmailCount} approved · Created {formatDate(row.createdAt)}</span>
        </div>
        <div>
          <span className="stream-type-badge">{row.status}</span>
          {!row.isDefault && <button className="still-button still-button-secondary" disabled={mutation.busy} onClick={() => mutation.run(`/api/admin/workspaces/${row.id}`, "PATCH", { status: row.status === "active" ? "suspended" : "active" })}>{row.status === "active" ? "Suspend" : "Reactivate"}</button>}
        </div>
      </div>)}
    </div>
    <MutationMessage mutation={mutation} />
  </AdminCard>
}

function useAdminMutation(refresh: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const run = useCallback(async <T = unknown>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T | null> => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const payload = await response.json()
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || "Admin change failed.")
      setNotice("Saved."); refresh(); return payload as T
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Admin change failed."); return null
    } finally { setBusy(false) }
  }, [refresh])
  return { busy, error, notice, run }
}

type Mutation = ReturnType<typeof useAdminMutation>
function MutationButton({ children, disabled, mutation, onClick }: { children: React.ReactNode; disabled?: boolean; mutation: Mutation; onClick: () => void }) { return <button className="still-button still-button-primary" disabled={disabled || mutation.busy} onClick={onClick}>{mutation.busy ? "Saving…" : children}</button> }
function MutationMessage({ mutation }: { mutation: Mutation }) { return mutation.error ? <div className="stream-message stream-message-error" role="alert">{mutation.error}</div> : mutation.notice ? <div className="stream-message" role="status">{mutation.notice}</div> : null }
function AdminGrid({ children, aside }: { children: React.ReactNode; aside: React.ReactNode }) { return <div className="admin-controls-grid"><div>{children}</div><div>{aside}</div></div> }
function AdminCard({ title, meta, children }: { title: string; meta?: string | null; children: React.ReactNode }) { return <section className="admin-control-card"><div className="admin-control-card-heading"><h2>{title}</h2>{meta && <span>{meta}</span>}</div>{children}</section> }
function Empty({ children }: { children: React.ReactNode }) { return <div className="admin-control-empty">{children}</div> }
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) { return <label className="admin-control-field"><span>{label}</span><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label> }
function ScopePicker({ permissions, selected, onToggle }: { permissions: Permission[]; selected: string[]; onToggle: (scope: string) => void }) { return <div className="admin-scope-picker">{permissions.map(permission => <label key={permission.id}><input type="checkbox" checked={selected.includes(permission.scope)} onChange={() => onToggle(permission.scope)} /><span><strong>{permission.scope}</strong>{permission.description}</span></label>)}</div> }
function toggle(values: string[], value: string) { return values.includes(value) ? values.filter(item => item !== value) : [...values, value] }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value)) }
