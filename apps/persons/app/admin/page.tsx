"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"

type Permission = { id: string; scope: string; description: string | null }
type Role = {
  id: string
  key: string
  name: string
  description: string | null
  userCount: number
  permissions: Permission[]
}
type ApiKey = {
  id: string
  name: string
  keyPrefix: string
  status: string
  scopes: string[]
  createdAt: string
  updatedAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  createdByUser: { id: string; email: string; name: string | null } | null
}
type User = {
  id: string
  email: string
  name: string | null
  status: string
  roles: { id: string; key: string; name: string }[]
}
type AuditLog = {
  id: string
  createdAt: string
  action: string
  targetType: string
  targetId: string | null
  actorType: string
  actorLabel: string | null
  metadata: unknown
}
type Overview = {
  currentUser: { id: string; email: string; scopes: string[] }
  users: User[]
  roles: Role[]
  permissions: Permission[]
  apiKeys: ApiKey[]
  auditCount: number
}

const TABS = ["apiKeys", "roles", "permissions", "audit"] as const
type Tab = typeof TABS[number]

export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [tab, setTab] = useState<Tab>("apiKeys")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)

  const [keyName, setKeyName] = useState("")
  const [keyScopes, setKeyScopes] = useState<string[]>(["contacts.read", "interactions.read"])
  const [roleName, setRoleName] = useState("")
  const [roleKey, setRoleKey] = useState("")
  const [roleDescription, setRoleDescription] = useState("")
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [selectedRoleScopes, setSelectedRoleScopes] = useState<string[]>([])
  const [userRoleDraft, setUserRoleDraft] = useState<Record<string, string[]>>({})

  const selectedRole = useMemo(
    () => overview?.roles.find(role => role.id === selectedRoleId) ?? overview?.roles[0] ?? null,
    [overview?.roles, selectedRoleId],
  )

  useEffect(() => {
    loadOverview()
  }, [])

  useEffect(() => {
    if (!selectedRole) return
    setSelectedRoleId(selectedRole.id)
    setSelectedRoleScopes(selectedRole.permissions.map(permission => permission.scope))
  }, [selectedRole?.id])

  useEffect(() => {
    if (tab === "audit") loadAudit()
  }, [tab])

  async function loadOverview() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/access")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not load admin data")
      setOverview(data)
      setSelectedRoleId(data.roles?.[0]?.id ?? null)
      setUserRoleDraft(Object.fromEntries(
        (data.users ?? []).map((user: User) => [user.id, user.roles.map(role => role.id)]),
      ))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load admin data")
    } finally {
      setLoading(false)
    }
  }

  async function loadAudit() {
    try {
      const res = await fetch("/api/admin/audit?limit=150")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not load audit log")
      setAuditLogs(data.logs ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load audit log")
    }
  }

  async function createKey() {
    if (!keyName.trim() || keyScopes.length === 0) return
    setSaving(true)
    setError(null)
    setNewSecret(null)
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName, scopes: keyScopes }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not create API key")
      setNewSecret(data.secret)
      setKeyName("")
      await loadOverview()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create API key")
    } finally {
      setSaving(false)
    }
  }

  async function updateKeyStatus(id: string, status: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/api-keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not update API key")
      await loadOverview()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update API key")
    } finally {
      setSaving(false)
    }
  }

  async function createRole() {
    if (!roleName.trim() || !roleKey.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: roleKey, name: roleName, description: roleDescription, scopes: [] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not create role")
      setRoleName("")
      setRoleKey("")
      setRoleDescription("")
      await loadOverview()
      setSelectedRoleId(data.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create role")
    } finally {
      setSaving(false)
    }
  }

  async function saveRoleScopes() {
    if (!selectedRole) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/roles/${selectedRole.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopes: selectedRoleScopes }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not update role")
      await loadOverview()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update role")
    } finally {
      setSaving(false)
    }
  }

  async function saveUserRoles(userId: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/roles`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleIds: userRoleDraft[userId] ?? [] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not update user roles")
      await loadOverview()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update user roles")
    } finally {
      setSaving(false)
    }
  }

  function toggleScope(scope: string, selected: string[], setSelected: (next: string[]) => void) {
    setSelected(selected.includes(scope)
      ? selected.filter(item => item !== scope)
      : [...selected, scope].sort())
  }

  const permissions = overview?.permissions ?? []

  return (
    <div style={{ minHeight: "calc(100vh - 52px)", background: "var(--bg)", color: "var(--ink)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", minHeight: "calc(100vh - 52px)" }}>
        <aside style={{ borderRight: "1px solid var(--border)", background: "var(--surface)", padding: "18px 14px" }}>
          <h1 style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: 600 }}>Admin</h1>
          <div style={{ display: "grid", gap: "6px" }}>
            <TabButton active={tab === "apiKeys"} onClick={() => setTab("apiKeys")} label="API Keys" />
            <TabButton active={tab === "roles"} onClick={() => setTab("roles")} label="Roles" />
            <TabButton active={tab === "permissions"} onClick={() => setTab("permissions")} label="Permissions" />
            <TabButton active={tab === "audit"} onClick={() => setTab("audit")} label="Audit" />
          </div>
          <div style={{ marginTop: "22px", paddingTop: "16px", borderTop: "1px solid var(--border)", fontSize: "11px", color: "var(--ink-3)", lineHeight: 1.6 }}>
            <div>{overview?.currentUser.email ?? ""}</div>
            <div>{overview?.currentUser.scopes.includes("*") ? "owner" : `${overview?.currentUser.scopes.length ?? 0} scopes`}</div>
          </div>
        </aside>

        <main style={{ padding: "24px", maxWidth: "1180px", width: "100%" }}>
          {error && (
            <div style={{ marginBottom: "14px", border: "1px solid #d46a3a", background: "#fff3ed", color: "#8f3518", borderRadius: "8px", padding: "10px 12px", fontSize: "12px" }}>
              {error}
            </div>
          )}

          {loading && <div style={{ fontSize: "12px", color: "var(--ink-3)" }}>Loading...</div>}

          {!loading && overview && tab === "apiKeys" && (
            <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: "18px" }}>
              <Panel title="API Keys" meta={`${overview.apiKeys.length} keys`}>
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <Th>Name</Th>
                        <Th>Prefix</Th>
                        <Th>Status</Th>
                        <Th>Scopes</Th>
                        <Th>Last Used</Th>
                        <Th></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.apiKeys.map(key => (
                        <tr key={key.id}>
                          <Td strong>{key.name}</Td>
                          <Td>{key.keyPrefix}</Td>
                          <Td><StatusPill status={key.status} /></Td>
                          <Td>{key.scopes.join(", ")}</Td>
                          <Td>{formatDate(key.lastUsedAt)}</Td>
                          <Td align="right">
                            <button style={smallButtonStyle} disabled={saving} onClick={() => updateKeyStatus(key.id, key.status === "active" ? "revoked" : "active")}>
                              {key.status === "active" ? "Revoke" : "Activate"}
                            </button>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="New Key">
                <Field label="Name" value={keyName} onChange={setKeyName} placeholder="iMessage watcher" />
                <ScopePicker permissions={permissions} selected={keyScopes} onToggle={scope => toggleScope(scope, keyScopes, setKeyScopes)} compact />
                <button style={primaryButtonStyle} disabled={saving || !keyName.trim() || !keyScopes.length} onClick={createKey}>
                  Create
                </button>
                {newSecret && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "5px" }}>Secret</div>
                    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "9px", fontSize: "11px", lineHeight: 1.4, wordBreak: "break-all" }}>
                      {newSecret}
                    </div>
                  </div>
                )}
              </Panel>
            </section>
          )}

          {!loading && overview && tab === "roles" && (
            <section style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 300px", gap: "18px" }}>
              <Panel title="Roles" meta={`${overview.roles.length} roles`}>
                <div style={{ display: "grid", gap: "8px" }}>
                  {overview.roles.map(role => (
                    <button
                      key={role.id}
                      onClick={() => setSelectedRoleId(role.id)}
                      style={{
                        textAlign: "left",
                        border: `1px solid ${role.id === selectedRole?.id ? "var(--accent)" : "var(--border)"}`,
                        background: role.id === selectedRole?.id ? "var(--accent-soft)" : "var(--bg)",
                        borderRadius: "8px",
                        padding: "10px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <div style={{ fontSize: "12px", fontWeight: 600 }}>{role.name}</div>
                      <div style={{ fontSize: "10px", color: "var(--ink-4)" }}>{role.key} · {role.userCount} users</div>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title={selectedRole?.name ?? "Role"} meta={selectedRole?.key}>
                {selectedRole && (
                  <>
                    <div style={{ marginBottom: "12px", fontSize: "12px", color: "var(--ink-3)", minHeight: "18px" }}>
                      {selectedRole.description}
                    </div>
                    <ScopePicker permissions={permissions} selected={selectedRoleScopes} onToggle={scope => toggleScope(scope, selectedRoleScopes, setSelectedRoleScopes)} />
                    <button style={primaryButtonStyle} disabled={saving} onClick={saveRoleScopes}>
                      Save Role
                    </button>
                  </>
                )}
              </Panel>

              <Panel title="New Role">
                <Field label="Key" value={roleKey} onChange={setRoleKey} placeholder="partner" />
                <Field label="Name" value={roleName} onChange={setRoleName} placeholder="Partner" />
                <Field label="Description" value={roleDescription} onChange={setRoleDescription} placeholder="External collaborator" />
                <button style={primaryButtonStyle} disabled={saving || !roleName.trim() || !roleKey.trim()} onClick={createRole}>
                  Create
                </button>
                <div style={{ marginTop: "16px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                  <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "8px" }}>Users</div>
                  <div style={{ display: "grid", gap: "9px" }}>
                    {overview.users.map(user => (
                      <div key={user.id} style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "8px", background: "var(--bg)" }}>
                        <div style={{ fontSize: "11px", color: "var(--ink)" }}>{user.email}</div>
                        <div style={{ display: "grid", gap: "5px", marginTop: "7px" }}>
                          {overview.roles.map(role => (
                            <label key={role.id} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "var(--ink-3)" }}>
                              <input
                                type="checkbox"
                                checked={(userRoleDraft[user.id] ?? []).includes(role.id)}
                                onChange={() => {
                                  const selected = userRoleDraft[user.id] ?? []
                                  setUserRoleDraft(prev => ({
                                    ...prev,
                                    [user.id]: selected.includes(role.id)
                                      ? selected.filter(id => id !== role.id)
                                      : [...selected, role.id],
                                  }))
                                }}
                              />
                              {role.name}
                            </label>
                          ))}
                        </div>
                        <button style={{ ...smallButtonStyle, marginTop: "8px" }} disabled={saving} onClick={() => saveUserRoles(user.id)}>
                          Save
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            </section>
          )}

          {!loading && overview && tab === "permissions" && (
            <Panel title="Permissions" meta={`${permissions.length} scopes`}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px" }}>
                {permissions.map(permission => (
                  <div key={permission.id} style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "10px", background: "var(--surface)" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600 }}>{permission.scope}</div>
                    <div style={{ fontSize: "11px", color: "var(--ink-3)", marginTop: "4px" }}>{permission.description}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {!loading && overview && tab === "audit" && (
            <Panel title="Audit" meta={`${overview.auditCount} total`}>
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <Th>Time</Th>
                      <Th>Action</Th>
                      <Th>Actor</Th>
                      <Th>Target</Th>
                      <Th>Metadata</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map(log => (
                      <tr key={log.id}>
                        <Td>{formatDate(log.createdAt)}</Td>
                        <Td strong>{log.action}</Td>
                        <Td>{log.actorLabel || log.actorType}</Td>
                        <Td>{log.targetType}{log.targetId ? `:${log.targetId.slice(0, 8)}` : ""}</Td>
                        <Td>{formatMetadata(log.metadata)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </main>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--ink-3)",
        borderRadius: "7px",
        padding: "8px 10px",
        textAlign: "left",
        fontFamily: "inherit",
        fontSize: "12px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  )
}

function Panel({ title, meta, children }: { title: string; meta?: string | number | null; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface)", padding: "14px", alignSelf: "start" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "12px", gap: "12px" }}>
        <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>{title}</h2>
        {meta !== undefined && meta !== null && <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{meta}</span>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: "grid", gap: "5px", marginBottom: "10px" }}>
      <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{label}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        style={{
          height: "34px",
          border: "1px solid var(--border)",
          borderRadius: "7px",
          background: "var(--bg)",
          color: "var(--ink)",
          padding: "0 9px",
          fontFamily: "inherit",
          fontSize: "12px",
        }}
      />
    </label>
  )
}

function ScopePicker({ permissions, selected, onToggle, compact = false }: { permissions: Permission[]; selected: string[]; onToggle: (scope: string) => void; compact?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px", marginBottom: "12px", maxHeight: compact ? "360px" : "none", overflowY: compact ? "auto" : "visible" }}>
      {permissions.map(permission => {
        const checked = selected.includes(permission.scope)
        return (
          <label key={permission.id} style={{ display: "flex", gap: "8px", alignItems: "flex-start", border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`, borderRadius: "8px", padding: "8px", background: checked ? "var(--accent-soft)" : "var(--bg)", cursor: "pointer" }}>
            <input type="checkbox" checked={checked} onChange={() => onToggle(permission.scope)} style={{ marginTop: "2px" }} />
            <span>
              <span style={{ display: "block", fontSize: "11px", color: "var(--ink)", fontWeight: 600 }}>{permission.scope}</span>
              <span style={{ display: "block", fontSize: "10px", color: "var(--ink-4)", lineHeight: 1.35 }}>{permission.description}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const active = status === "active"
  return (
    <span style={{ display: "inline-flex", border: `1px solid ${active ? "#88a06a" : "var(--border)"}`, color: active ? "#526b37" : "var(--ink-3)", borderRadius: "999px", padding: "2px 7px", fontSize: "10px" }}>
      {status}
    </span>
  )
}

function Th({ children = null }: { children?: React.ReactNode }) {
  return <th style={{ textAlign: "left", padding: "8px", fontSize: "10px", color: "var(--ink-4)", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>{children}</th>
}

function Td({ children, strong = false, align = "left" }: { children: React.ReactNode; strong?: boolean; align?: "left" | "right" }) {
  return <td style={{ textAlign: align, padding: "9px 8px", fontSize: "11px", color: strong ? "var(--ink)" : "var(--ink-3)", borderBottom: "1px solid var(--border)", verticalAlign: "top", maxWidth: "360px" }}>{children}</td>
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
}

const primaryButtonStyle: React.CSSProperties = {
  height: "34px",
  border: "none",
  borderRadius: "7px",
  background: "var(--accent)",
  color: "white",
  padding: "0 12px",
  fontSize: "12px",
  fontFamily: "inherit",
  cursor: "pointer",
}

const smallButtonStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--ink-2)",
  borderRadius: "6px",
  padding: "5px 8px",
  fontSize: "10px",
  fontFamily: "inherit",
  cursor: "pointer",
}

function formatDate(value: string | null) {
  if (!value) return "Never"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatMetadata(value: unknown) {
  if (!value) return ""
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > 140 ? `${text.slice(0, 140)}...` : text
}
