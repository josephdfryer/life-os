"use client"

import type React from "react"

type Permission = { id: string; scope: string; description: string | null }
type Role = { id: string; key: string; name: string; description: string | null; userCount: number }
type User = { id: string; email: string }

type Props = {
  roles: Role[]
  users: User[]
  permissions: Permission[]
  selectedRole: Role | null
  selectedScopes: string[]
  userRoleDraft: Record<string, string[]>
  newRole: { key: string; name: string; description: string }
  saving: boolean
  onSelectRole: (id: string) => void
  onScopeToggle: (scope: string) => void
  onNewRoleChange: (field: "key" | "name" | "description", value: string) => void
  onCreateRole: () => void
  onSaveRole: () => void
  onToggleUserRole: (userId: string, roleId: string) => void
  onSaveUserRoles: (userId: string) => void
}

export function RolesTab(props: Props) {
  return (
    <section style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 300px", gap: "18px" }}>
      <Panel title="Roles" meta={`${props.roles.length} roles`}>
        <div style={{ display: "grid", gap: "8px" }}>
          {props.roles.map(role => (
            <button key={role.id} onClick={() => props.onSelectRole(role.id)} style={{ ...roleButtonStyle, borderColor: role.id === props.selectedRole?.id ? "var(--accent)" : "var(--border)", background: role.id === props.selectedRole?.id ? "var(--accent-soft)" : "var(--bg)" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>{role.name}</div>
              <div style={{ fontSize: "10px", color: "var(--ink-4)" }}>{role.key} · {role.userCount} users</div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={props.selectedRole?.name ?? "Role"} meta={props.selectedRole?.key}>
        {props.selectedRole && <>
          <div style={{ marginBottom: "12px", fontSize: "12px", color: "var(--ink-3)", minHeight: "18px" }}>{props.selectedRole.description}</div>
          <ScopePicker permissions={props.permissions} selected={props.selectedScopes} onToggle={props.onScopeToggle} />
          <button style={primaryButtonStyle} disabled={props.saving} onClick={props.onSaveRole}>Save Role</button>
        </>}
      </Panel>

      <Panel title="New Role">
        <Field label="Key" value={props.newRole.key} onChange={value => props.onNewRoleChange("key", value)} placeholder="partner" />
        <Field label="Name" value={props.newRole.name} onChange={value => props.onNewRoleChange("name", value)} placeholder="Partner" />
        <Field label="Description" value={props.newRole.description} onChange={value => props.onNewRoleChange("description", value)} placeholder="External collaborator" />
        <button style={primaryButtonStyle} disabled={props.saving || !props.newRole.name.trim() || !props.newRole.key.trim()} onClick={props.onCreateRole}>Create</button>
        <div style={{ marginTop: "16px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
          <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "8px" }}>Users</div>
          <div style={{ display: "grid", gap: "9px" }}>
            {props.users.map(user => <div key={user.id} style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "8px", background: "var(--bg)" }}>
              <div style={{ fontSize: "11px", color: "var(--ink)" }}>{user.email}</div>
              <div style={{ display: "grid", gap: "5px", marginTop: "7px" }}>
                {props.roles.map(role => <label key={role.id} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "var(--ink-3)" }}>
                  <input type="checkbox" checked={(props.userRoleDraft[user.id] ?? []).includes(role.id)} onChange={() => props.onToggleUserRole(user.id, role.id)} />{role.name}
                </label>)}
              </div>
              <button style={{ ...smallButtonStyle, marginTop: "8px" }} disabled={props.saving} onClick={() => props.onSaveUserRoles(user.id)}>Save</button>
            </div>)}
          </div>
        </div>
      </Panel>
    </section>
  )
}

function ScopePicker({ permissions, selected, onToggle }: { permissions: Permission[]; selected: string[]; onToggle: (scope: string) => void }) {
  return <div style={{ display: "grid", gap: "7px", marginBottom: "12px" }}>{permissions.map(permission => <label key={permission.id} style={{ display: "flex", gap: "7px", alignItems: "flex-start", fontSize: "10px", color: "var(--ink-3)" }}><input type="checkbox" checked={selected.includes(permission.scope)} onChange={() => onToggle(permission.scope)} /><span><strong style={{ display: "block", color: "var(--ink-2)" }}>{permission.scope}</strong>{permission.description}</span></label>)}</div>
}
function Panel({ title, meta, children }: { title: string; meta?: string | null; children: React.ReactNode }) { return <section style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface)", padding: "14px", alignSelf: "start" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}><h2 style={{ margin: 0, fontSize: "15px" }}>{title}</h2>{meta && <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{meta}</span>}</div>{children}</section> }
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) { return <label style={{ display: "grid", gap: "5px", marginBottom: "10px" }}><span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{label}</span><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} style={inputStyle} /></label> }
const roleButtonStyle: React.CSSProperties = { textAlign: "left", border: "1px solid", borderRadius: "8px", padding: "10px", cursor: "pointer", fontFamily: "inherit" }
const inputStyle: React.CSSProperties = { height: "34px", border: "1px solid var(--border)", borderRadius: "7px", background: "var(--bg)", color: "var(--ink)", padding: "0 9px", fontFamily: "inherit", fontSize: "12px" }
const smallButtonStyle: React.CSSProperties = { border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "6px", padding: "5px 8px", fontSize: "10px", cursor: "pointer" }
const primaryButtonStyle: React.CSSProperties = { border: "1px solid var(--accent)", background: "var(--accent)", color: "white", borderRadius: "7px", height: "34px", padding: "0 12px", fontSize: "11px", cursor: "pointer" }
