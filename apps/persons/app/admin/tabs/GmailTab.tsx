"use client"

import type React from "react"

export type GmailStatusView = {
  configured: boolean; redirectUri: string
  connection: { status: string; accountEmail: string | null; mailboxId: string; historyId: string | null; lastSyncedAt: string | null; lastError: string | null; messageCount: number } | null
}
export type GmailTraceView = {
  runs: { id: string; createdAt: string; metadata: Record<string, unknown> | null }[]
  messages: { id: string; status: string; externalMessageId: string; threadId: string | null; historyId: string | null; updatedAt: string; lastSeenAt: string | null; subject: string | null; snippet: string | null; from: { name: string | null; email: string }[]; to: { name: string | null; email: string }[]; linkedPeople: { id: string; person: { id: string; name: string } | null }[]; stagedItem: { id: string; summary: string | null; candidatePerson: { id: string; name: string } | null } | null }[]
}
type Props = {
  status: GmailStatusView | null; trace: GmailTraceView | null; syncResult: string | null
  backfillDays: string; unmatchedMode: "skip" | "stage"; saving: boolean
  backfillOptions: readonly { value: string; label: string }[]
  onBackfillChange: (value: string) => void; onUnmatchedModeChange: (value: "skip" | "stage") => void
  onSync: () => void; onRefreshStatus: () => void; onRefreshTrace: () => void
}

export function GmailTab(props: Props) {
  const connection = props.status?.connection
  return <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: "18px" }}>
    <Panel title="Gmail" meta={connection?.status ?? "not connected"}>
      {!props.status && <p>Loading Gmail status...</p>}
      {props.status && !props.status.configured && <Notice>Gmail OAuth is not configured yet. Add the Gmail OAuth variables in the deployment environment.</Notice>}
      {props.status && <Info label="Google Cloud redirect URI" value={props.status.redirectUri} />}
      {connection ? <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
        <div style={cardStyle}><strong>{connection.accountEmail ?? "Gmail account"}</strong><div>{connection.mailboxId}</div><div style={{ display: "flex", gap: "7px", marginTop: "8px" }}><Pill text={connection.status} /><Pill text={`${connection.messageCount} synced messages`} />{connection.historyId && <Pill text="incremental sync" />}</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}><Info label="Last synced" value={formatDate(connection.lastSyncedAt)} /><Info label="History ID" value={connection.historyId ?? "Not set"} /></div>
        {connection.lastError && <Notice>{connection.lastError}</Notice>}
        {props.syncResult && <pre style={preStyle}>{props.syncResult}</pre>}
      </div> : props.status?.configured ? <p>Connect Gmail to import email involving known People and optionally stage unmatched messages.</p> : null}
    </Panel>

    <Panel title="Actions">
      <a href="/api/gmail/google/connect?returnTo=/admin" style={primaryLinkStyle}>{connection ? "Reconnect Gmail" : "Connect Gmail"}</a>
      <OptionSelect label="Backfill range" value={props.backfillDays} options={props.backfillOptions} onChange={props.onBackfillChange} />
      <OptionSelect label="Unmatched email" value={props.unmatchedMode} options={[{ value: "skip", label: "Known People only" }, { value: "stage", label: "Stage unmatched in Inbox" }]} onChange={value => props.onUnmatchedModeChange(value === "stage" ? "stage" : "skip")} />
      <button style={primaryButtonStyle} disabled={props.saving || !connection} onClick={props.onSync}>{props.saving ? "Syncing..." : "Sync now"}</button>
      <button style={{ ...smallButtonStyle, width: "100%", marginTop: "9px" }} onClick={props.onRefreshStatus}>Refresh Status</button>
      <p style={helpStyle}>Sync is read-only, batched, and incremental after the first import.</p>
    </Panel>

    <div style={{ gridColumn: "1 / -1" }}><Panel title="Sync Trace" meta={props.trace ? `${props.trace.messages.length} recent messages` : "loading"}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}><span style={helpStyle}>Recent Gmail imports and their canonical or staged outcomes.</span><button style={smallButtonStyle} onClick={props.onRefreshTrace}>Refresh Trace</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "8px", marginBottom: "12px" }}>{(props.trace?.runs ?? []).slice(0, 3).map(run => <div key={run.id} style={cardStyle}><div>{formatDate(run.createdAt)}</div><div>{formatRun(run.metadata)}</div></div>)}</div>
      <div style={{ display: "grid", gap: "8px" }}>{(props.trace?.messages ?? []).map(message => <article key={message.id} style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><strong>{message.subject || message.stagedItem?.summary || "Gmail message"}</strong><Pill text={message.status} /></div>
        <div style={helpStyle}>{formatDate(message.lastSeenAt ?? message.updatedAt)} · {parties("From", message.from)} · {parties("To", message.to)}</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "7px" }}>{message.linkedPeople.filter(item => item.person).map(item => <a key={item.id} href={`/persons/${item.person!.id}`} style={personLinkStyle}>{item.person!.name}</a>)}{message.stagedItem && <a href="/inbox" style={personLinkStyle}>Inbox: {message.stagedItem.candidatePerson?.name ?? "review"}</a>}</div>
        {message.snippet && <p style={helpStyle}>{message.snippet}</p>}
      </article>)}</div>
    </Panel></div>
  </section>
}

function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) { return <section style={panelStyle}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}><h2 style={{ margin: 0, fontSize: "15px" }}>{title}</h2>{meta && <span style={helpStyle}>{meta}</span>}</div>{children}</section> }
function OptionSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void }) { return <label style={{ display: "grid", gap: "5px", marginBottom: "10px" }}><span style={helpStyle}>{label}</span><select value={value} onChange={event => onChange(event.target.value)} style={selectStyle}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }
function Info({ label, value }: { label: string; value: string }) { return <div style={cardStyle}><div style={helpStyle}>{label}</div><div style={{ wordBreak: "break-word" }}>{value}</div></div> }
function Notice({ children }: { children: React.ReactNode }) { return <div style={{ ...cardStyle, color: "#8f3518", background: "#fff3ed" }}>{children}</div> }
function Pill({ text }: { text: string }) { return <span style={{ border: "1px solid var(--border)", borderRadius: "999px", padding: "2px 6px", fontSize: "9px" }}>{text}</span> }
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Never"
const parties = (label: string, values: { name: string | null; email: string }[]) => `${label}: ${values.slice(0, 3).map(value => value.name || value.email).join(", ") || "unknown"}`
const formatRun = (value: Record<string, unknown> | null) => value ? `${Number(value.createdInteractions ?? 0)} created, ${Number(value.updatedInteractions ?? 0)} appended, ${Number(value.staged ?? 0)} staged, ${Number(value.skipped ?? 0)} skipped` : "Sync run"
const panelStyle: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface)", padding: "14px", alignSelf: "start" }
const cardStyle: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "10px", fontSize: "11px", lineHeight: 1.5 }
const helpStyle: React.CSSProperties = { fontSize: "10px", color: "var(--ink-4)", lineHeight: 1.5 }
const selectStyle: React.CSSProperties = { height: "34px", border: "1px solid var(--border)", borderRadius: "7px", background: "var(--bg)", color: "var(--ink)", padding: "0 9px" }
const smallButtonStyle: React.CSSProperties = { border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "6px", padding: "5px 8px", fontSize: "10px", cursor: "pointer" }
const primaryButtonStyle: React.CSSProperties = { ...smallButtonStyle, width: "100%", height: "34px", background: "var(--accent)", color: "white" }
const primaryLinkStyle: React.CSSProperties = { ...primaryButtonStyle, display: "block", textAlign: "center", lineHeight: "34px", textDecoration: "none", marginBottom: "10px" }
const personLinkStyle: React.CSSProperties = { border: "1px solid #88a06a", color: "#526b37", borderRadius: "999px", padding: "3px 8px", fontSize: "10px", textDecoration: "none" }
const preStyle: React.CSSProperties = { ...cardStyle, whiteSpace: "pre-wrap", wordBreak: "break-word" }
