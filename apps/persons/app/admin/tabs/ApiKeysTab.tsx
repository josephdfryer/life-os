"use client"

import type React from "react"

type Permission = { id: string; scope: string; description: string | null }
type ApiKey = {
  id: string
  name: string
  keyPrefix: string
  status: string
  scopes: string[]
  lastUsedAt: string | null
}

type Props = {
  apiKeys: ApiKey[]
  permissions: Permission[]
  selectedScopes: string[]
  name: string
  secret: string | null
  saving: boolean
  onNameChange: (value: string) => void
  onScopeToggle: (scope: string) => void
  onCreate: () => void
  onStatusChange: (id: string, status: string) => void
}

export function ApiKeysTab(props: Props) {
  return (
    <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: "18px" }}>
      <Panel title="API Keys" meta={`${props.apiKeys.length} keys`}>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead><tr><Th>Name</Th><Th>Prefix</Th><Th>Status</Th><Th>Scopes</Th><Th>Last Used</Th><Th /></tr></thead>
            <tbody>
              {props.apiKeys.map(key => (
                <tr key={key.id}>
                  <Td strong>{key.name}</Td>
                  <Td>{key.keyPrefix}</Td>
                  <Td><StatusPill status={key.status} /></Td>
                  <Td>{key.scopes.join(", ")}</Td>
                  <Td>{formatDate(key.lastUsedAt)}</Td>
                  <Td align="right">
                    <button style={smallButtonStyle} disabled={props.saving} onClick={() => props.onStatusChange(key.id, key.status === "active" ? "revoked" : "active")}>
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
        <Field label="Name" value={props.name} onChange={props.onNameChange} placeholder="iMessage watcher" />
        <div style={{ display: "grid", gap: "6px", marginBottom: "12px" }}>
          {props.permissions.map(permission => (
            <label key={permission.id} style={{ display: "flex", gap: "7px", alignItems: "flex-start", fontSize: "10px", color: "var(--ink-3)" }}>
              <input type="checkbox" checked={props.selectedScopes.includes(permission.scope)} onChange={() => props.onScopeToggle(permission.scope)} />
              <span><strong style={{ display: "block", color: "var(--ink-2)" }}>{permission.scope}</strong>{permission.description}</span>
            </label>
          ))}
        </div>
        <button style={primaryButtonStyle} disabled={props.saving || !props.name.trim() || !props.selectedScopes.length} onClick={props.onCreate}>Create</button>
        {props.secret && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "5px" }}>Secret</div>
            <div style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "9px", fontSize: "11px", lineHeight: 1.4, wordBreak: "break-all" }}>{props.secret}</div>
          </div>
        )}
      </Panel>
    </section>
  )
}

function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return <section style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface)", padding: "14px", alignSelf: "start" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}><h2 style={{ margin: 0, fontSize: "15px" }}>{title}</h2>{meta && <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{meta}</span>}</div>{children}
  </section>
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label style={{ display: "grid", gap: "5px", marginBottom: "10px" }}><span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{label}</span><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} style={inputStyle} /></label>
}
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ padding: "8px", textAlign: "left", fontSize: "10px", color: "var(--ink-4)" }}>{children}</th> }
function Td({ children, strong, align = "left" }: { children: React.ReactNode; strong?: boolean; align?: "left" | "right" }) { return <td style={{ padding: "8px", borderTop: "1px solid var(--border)", fontSize: "11px", fontWeight: strong ? 600 : 400, textAlign: align }}>{children}</td> }
function StatusPill({ status }: { status: string }) { return <span style={{ border: "1px solid var(--border)", borderRadius: "999px", padding: "2px 6px", fontSize: "9px" }}>{status}</span> }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Never" }
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse" }
const inputStyle: React.CSSProperties = { height: "34px", border: "1px solid var(--border)", borderRadius: "7px", background: "var(--bg)", color: "var(--ink)", padding: "0 9px", fontFamily: "inherit", fontSize: "12px" }
const smallButtonStyle: React.CSSProperties = { border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "6px", padding: "5px 8px", fontSize: "10px", cursor: "pointer" }
const primaryButtonStyle: React.CSSProperties = { border: "1px solid var(--accent)", background: "var(--accent)", color: "white", borderRadius: "7px", height: "34px", padding: "0 12px", fontSize: "11px", cursor: "pointer" }
