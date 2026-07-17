"use client"

import type React from "react"

export type PermissionSummary = { id: string; scope: string; description: string | null }
export type AuditSummary = {
  id: string
  createdAt: string
  action: string
  targetType: string
  targetId: string | null
  actorType: string
  actorLabel: string | null
  metadata: unknown
}

export function PermissionsTab({ permissions }: { permissions: PermissionSummary[] }) {
  return (
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
  )
}

export function CalendarTab({ eventsAppUrl }: { eventsAppUrl: string }) {
  return (
    <Panel title="Google Calendar moved to Events">
      <div style={{ fontSize: "12px", color: "var(--ink-3)", lineHeight: 1.6, marginBottom: "14px" }}>
        Calendar connect, sync, and import trace now live in the Events app — the lens for the Event primitive.
      </div>
      <a href={`${eventsAppUrl}/settings/calendar`} style={{ ...primaryLinkStyle, display: "inline-block", textDecoration: "none" }}>
        Open Calendar sync in Events
      </a>
    </Panel>
  )
}

export function AuditTab({ logs, total }: { logs: AuditSummary[]; total: number }) {
  return (
    <Panel title="Audit" meta={`${total} total`}>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr><Th>Time</Th><Th>Action</Th><Th>Actor</Th><Th>Target</Th><Th>Metadata</Th></tr></thead>
          <tbody>
            {logs.map(log => (
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
  )
}

function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface)", padding: "14px", alignSelf: "start" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "12px", gap: "12px" }}>
        <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>{title}</h2>
        {meta && <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{meta}</span>}
      </div>
      {children}
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "8px", textAlign: "left", color: "var(--ink-4)", fontSize: "10px", fontWeight: 500 }}>{children}</th>
}

function Td({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return <td style={{ padding: "8px", borderTop: "1px solid var(--border)", fontSize: "11px", fontWeight: strong ? 600 : 400 }}>{children}</td>
}

function formatDate(value: string | null) {
  if (!value) return "Never"
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

function formatMetadata(value: unknown) {
  if (!value) return ""
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > 140 ? `${text.slice(0, 140)}...` : text
}

const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse" }
const primaryLinkStyle: React.CSSProperties = {
  border: "1px solid var(--accent)", background: "var(--accent)", color: "white", borderRadius: "7px",
  padding: "0 12px", fontSize: "11px", fontFamily: "inherit", cursor: "pointer", lineHeight: "34px",
}
