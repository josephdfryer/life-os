"use client"

import type React from "react"

type Rule = { id: string; name: string; status: string; trigger: string; mode: string; priority: number }
type RuleRun = { id: string; createdAt: string; matched: boolean; status: string; targetType: string | null; targetId: string | null; message: string | null; actionsPlanned: unknown; actionsApplied: unknown; rule: { name: string } }
type Template = { name: string; trigger: string; mode: string }
type Option = { value: string; label: string }
type Editor = { name: string; description: string; trigger: string; status: string; mode: string; priority: string; stopProcessing: boolean; conditions: string; actions: string }
type Filters = { ruleId: string; trigger: string; matched: string; status: string }

type Props = {
  rules: Rule[]; runs: RuleRun[]; selectedRule: Rule | null; templates: readonly Template[]
  conditionHelpers: readonly { label: string; item: unknown }[]; actionHelpers: readonly { label: string; item: unknown }[]
  editor: Editor; testPayload: string; testResult: string | null; filters: Filters; ruleOptions: Option[]
  triggerOptions: string[]; runStatusOptions: string[]; saving: boolean
  onSelectRule: (id: string) => void; onNewRule: () => void; onTemplate: (template: Template) => void
  onEditorChange: (field: keyof Editor, value: string | boolean) => void
  onAppendCondition: (item: unknown) => void; onAppendAction: (item: unknown) => void
  onSave: () => void; onTest: () => void; onTestPayloadChange: (value: string) => void
  onFilterChange: (field: keyof Filters, value: string) => void; onRefreshRuns: () => void; onFocusSelected: () => void
}

export function RulesTab(props: Props) {
  const editing = Boolean(props.selectedRule)
  return <section style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 340px", gap: "18px" }}>
    <Panel title="Rules" meta={`${props.rules.length} rules`}>
      <button style={{ ...smallButtonStyle, marginBottom: "10px" }} onClick={props.onNewRule}>New Rule</button>
      <div style={{ display: "grid", gap: "7px", marginBottom: "12px" }}>{props.templates.map(template => <button key={template.name} style={templateButtonStyle} onClick={() => props.onTemplate(template)}><strong style={{ display: "block", fontSize: "11px" }}>{template.name}</strong><span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{template.trigger} · {template.mode}</span></button>)}</div>
      <div style={{ display: "grid", gap: "8px" }}>{props.rules.map(rule => <button key={rule.id} onClick={() => props.onSelectRule(rule.id)} style={{ ...templateButtonStyle, borderColor: rule.id === props.selectedRule?.id ? "var(--accent)" : "var(--border)", background: rule.id === props.selectedRule?.id ? "var(--accent-soft)" : "var(--bg)" }}><div style={{ display: "flex", justifyContent: "space-between" }}><strong>{rule.name}</strong><Pill text={rule.status} /></div><span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{rule.trigger} · {rule.mode} · p{rule.priority}</span></button>)}</div>
    </Panel>

    <Panel title={editing ? "Edit Rule" : "New Rule"} meta={props.selectedRule?.id.slice(0, 8)}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <Field label="Name" value={props.editor.name} onChange={value => props.onEditorChange("name", value)} />
        <Select label="Trigger" value={props.editor.trigger} options={props.triggerOptions} onChange={value => props.onEditorChange("trigger", value)} />
        <Select label="Status" value={props.editor.status} options={["active", "paused", "draft"]} onChange={value => props.onEditorChange("status", value)} />
        <Select label="Mode" value={props.editor.mode} options={["auto", "suggest", "block", "dry_run"]} onChange={value => props.onEditorChange("mode", value)} />
        <Field label="Priority" value={props.editor.priority} onChange={value => props.onEditorChange("priority", value)} />
        <label style={checkStyle}><input type="checkbox" checked={props.editor.stopProcessing} onChange={event => props.onEditorChange("stopProcessing", event.target.checked)} />Stop after match</label>
      </div>
      <Field label="Description" value={props.editor.description} onChange={value => props.onEditorChange("description", value)} />
      <HelperRow label="Condition shortcuts" items={props.conditionHelpers} onPick={props.onAppendCondition} />
      <Code label="Conditions" value={props.editor.conditions} onChange={value => props.onEditorChange("conditions", value)} />
      <HelperRow label="Action shortcuts" items={props.actionHelpers} onPick={props.onAppendAction} />
      <Code label="Actions" value={props.editor.actions} onChange={value => props.onEditorChange("actions", value)} />
      <div style={{ display: "flex", gap: "8px" }}><button style={primaryButtonStyle} disabled={props.saving || !props.editor.name.trim() || !props.editor.trigger.trim()} onClick={props.onSave}>{editing ? "Save Rule" : "Create Rule"}</button><button style={smallButtonStyle} disabled={props.saving} onClick={props.onTest}>Dry Run</button></div>
    </Panel>

    <Panel title="Test & Runs" meta={`${props.runs.length} runs`}>
      <Code label="Payload" value={props.testPayload} onChange={props.onTestPayloadChange} />
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "10px", marginBottom: "12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <OptionSelect label="Rule" value={props.filters.ruleId} options={props.ruleOptions} onChange={value => props.onFilterChange("ruleId", value)} />
          <Select label="Trigger" value={props.filters.trigger} options={["all", ...props.triggerOptions]} onChange={value => props.onFilterChange("trigger", value)} />
          <Select label="Outcome" value={props.filters.matched} options={["all", "matched", "skipped"]} onChange={value => props.onFilterChange("matched", value)} />
          <Select label="Status" value={props.filters.status} options={props.runStatusOptions} onChange={value => props.onFilterChange("status", value)} />
        </div>
        <div style={{ display: "flex", gap: "8px" }}><button style={smallButtonStyle} onClick={props.onRefreshRuns}>Refresh</button><button style={smallButtonStyle} disabled={!props.selectedRule} onClick={props.onFocusSelected}>Selected Rule</button></div>
      </div>
      {props.testResult && <pre style={preStyle}>{props.testResult}</pre>}
      <div style={{ display: "grid", gap: "8px", maxHeight: "420px", overflowY: "auto" }}>{props.runs.map(run => <div key={run.id} style={runStyle}><div style={{ display: "flex", justifyContent: "space-between" }}><strong>{run.rule.name}</strong><span>{run.matched ? "matched" : "skipped"}</span></div><div style={{ fontSize: "10px", color: "var(--ink-4)" }}>{formatDate(run.createdAt)} · {run.status}{run.targetType ? ` · ${run.targetType}${run.targetId ? `:${run.targetId.slice(0, 8)}` : ""}` : ""}</div>{run.message && <div>{run.message}</div>}<div style={{ display: "flex", gap: "6px" }}>{count(run.actionsPlanned) > 0 && <Pill text={`${count(run.actionsPlanned)} planned`} />}{count(run.actionsApplied) > 0 && <Pill text={`${count(run.actionsApplied)} applied`} />}</div></div>)}</div>
    </Panel>
  </section>
}

function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) { return <section style={panelStyle}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}><h2 style={{ margin: 0, fontSize: "15px" }}>{title}</h2>{meta && <span>{meta}</span>}</div>{children}</section> }
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label style={fieldStyle}><span>{label}</span><input value={value} onChange={event => onChange(event.target.value)} style={inputStyle} /></label> }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label style={fieldStyle}><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)} style={inputStyle}>{options.map(option => <option key={option}>{option}</option>)}</select></label> }
function OptionSelect({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) { return <label style={fieldStyle}><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)} style={inputStyle}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }
function Code({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label style={fieldStyle}><span>{label}</span><textarea rows={6} value={value} onChange={event => onChange(event.target.value)} style={{ ...inputStyle, height: "auto", padding: "8px", fontFamily: "monospace" }} /></label> }
function HelperRow({ label, items, onPick }: { label: string; items: readonly { label: string; item: unknown }[]; onPick: (item: unknown) => void }) { return <div style={{ marginBottom: "8px" }}><span style={{ fontSize: "10px" }}>{label}</span><div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>{items.map(item => <button key={item.label} type="button" style={chipStyle} onClick={() => onPick(item.item)}>{item.label}</button>)}</div></div> }
function Pill({ text }: { text: string }) { return <span style={{ border: "1px solid var(--border)", borderRadius: "999px", padding: "2px 6px", fontSize: "9px" }}>{text}</span> }
const count = (value: unknown) => Array.isArray(value) ? value.length : 0
const formatDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
const panelStyle: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface)", padding: "14px", alignSelf: "start" }
const fieldStyle: React.CSSProperties = { display: "grid", gap: "5px", marginBottom: "10px", fontSize: "10px", color: "var(--ink-4)" }
const inputStyle: React.CSSProperties = { height: "34px", border: "1px solid var(--border)", borderRadius: "7px", background: "var(--bg)", color: "var(--ink)", padding: "0 9px", fontFamily: "inherit", fontSize: "12px" }
const checkStyle: React.CSSProperties = { display: "flex", gap: "8px", alignItems: "center", fontSize: "11px" }
const templateButtonStyle: React.CSSProperties = { textAlign: "left", border: "1px solid var(--border)", background: "var(--bg)", borderRadius: "8px", padding: "8px", cursor: "pointer" }
const smallButtonStyle: React.CSSProperties = { border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "6px", padding: "5px 8px", fontSize: "10px", cursor: "pointer" }
const primaryButtonStyle: React.CSSProperties = { ...smallButtonStyle, background: "var(--accent)", color: "white", height: "34px" }
const chipStyle: React.CSSProperties = { ...smallButtonStyle, borderRadius: "999px" }
const preStyle: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: "8px", padding: "9px", whiteSpace: "pre-wrap", fontSize: "10px" }
const runStyle: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "8px", fontSize: "10px" }
