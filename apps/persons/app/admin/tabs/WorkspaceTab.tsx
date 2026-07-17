"use client"

import type React from "react"

type ApprovedEmail = {
  id: string
  email: string
  status: string
  createdAt: string
  workspace: { name: string } | null
  invitedBy: { email: string } | null
}
type Workspace = { id: string; name: string }

type Props = {
  approvedEmails: ApprovedEmail[]
  workspaces: Workspace[]
  saving: boolean
  inviteEmail: string
  inviteWorkspaceId: string
  onInviteEmailChange: (value: string) => void
  onInviteWorkspaceChange: (value: string) => void
  onSendInvite: () => void
  onStatusChange: (id: string, status: string) => void
}

export function WorkspaceTab(props: Props) {
  return (
    <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "18px" }}>
      <Panel title="Approved Sign-ins" meta={`${props.approvedEmails.length} emails`}>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead><tr><Th>Email</Th><Th>Status</Th><Th>Workspace</Th><Th>Invited by</Th><Th>Approved</Th><Th /></tr></thead>
            <tbody>
              {props.approvedEmails.map(entry => (
                <tr key={entry.id}>
                  <Td strong>{entry.email}</Td>
                  <Td><StatusPill status={entry.status} /></Td>
                  <Td>{entry.workspace?.name ?? <span style={{ color: "var(--ink-4)" }}>own workspace</span>}</Td>
                  <Td>{entry.invitedBy?.email ?? "—"}</Td>
                  <Td>{formatDate(entry.createdAt)}</Td>
                  <Td align="right">
                    <button style={smallButtonStyle} disabled={props.saving} onClick={() => props.onStatusChange(entry.id, entry.status === "approved" ? "revoked" : "approved")}>
                      {entry.status === "approved" ? "Revoke" : "Re-approve"}
                    </button>
                  </Td>
                </tr>
              ))}
              {props.approvedEmails.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: "18px", fontSize: "11px", color: "var(--ink-4)" }}>No approved emails yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Approve Email">
        <Field label="Email" value={props.inviteEmail} onChange={props.onInviteEmailChange} placeholder="name@example.com" />
        <label style={{ display: "grid", gap: "5px", marginBottom: "12px" }}>
          <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>Workspace</span>
          <select value={props.inviteWorkspaceId} onChange={event => props.onInviteWorkspaceChange(event.target.value)} style={inputStyle}>
            <option value="own">Own workspace (isolated)</option>
            {props.workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>
        <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "12px", lineHeight: 1.5 }}>
          {props.inviteWorkspaceId === "own"
            ? "This person gets a clean, private workspace when they first sign in."
            : `This person will share data in "${props.workspaces.find(workspace => workspace.id === props.inviteWorkspaceId)?.name}".`}
        </div>
        <button style={primaryButtonStyle} disabled={props.saving || !props.inviteEmail.trim()} onClick={props.onSendInvite}>Approve</button>
      </Panel>
    </section>
  )
}

function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return <section style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface)", padding: "14px", alignSelf: "start" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}><h2 style={{ margin: 0, fontSize: "15px" }}>{title}</h2>{meta && <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{meta}</span>}</div>
    {children}
  </section>
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label style={{ display: "grid", gap: "5px", marginBottom: "10px" }}><span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{label}</span><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} style={inputStyle} /></label>
}
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ padding: "8px", textAlign: "left", fontSize: "10px", color: "var(--ink-4)" }}>{children}</th> }
function Td({ children, strong, align = "left" }: { children: React.ReactNode; strong?: boolean; align?: "left" | "right" }) { return <td style={{ padding: "8px", borderTop: "1px solid var(--border)", fontSize: "11px", fontWeight: strong ? 600 : 400, textAlign: align }}>{children}</td> }
function StatusPill({ status }: { status: string }) { return <span style={{ border: "1px solid var(--border)", borderRadius: "999px", padding: "2px 6px", fontSize: "9px" }}>{status}</span> }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) }
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse" }
const inputStyle: React.CSSProperties = { height: "34px", border: "1px solid var(--border)", borderRadius: "7px", background: "var(--bg)", color: "var(--ink)", padding: "0 9px", fontFamily: "inherit", fontSize: "12px" }
const smallButtonStyle: React.CSSProperties = { border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "6px", padding: "5px 8px", fontSize: "10px", cursor: "pointer" }
const primaryButtonStyle: React.CSSProperties = { border: "1px solid var(--accent)", background: "var(--accent)", color: "white", borderRadius: "7px", height: "34px", padding: "0 12px", fontSize: "11px", cursor: "pointer" }
