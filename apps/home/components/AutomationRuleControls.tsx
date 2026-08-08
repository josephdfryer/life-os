"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export type EditableRule = {
  id?: string
  name: string
  description: string
  trigger: string
  status: string
  mode: string
  priority: number
  conditions: string
  actions: string
  stopProcessing: boolean
}

type Feedback = { tone: "error" | "success"; text: string } | null

const NEW_RULE: EditableRule = {
  name: "",
  description: "",
  trigger: "inbox.stage",
  status: "draft",
  mode: "suggest",
  priority: 100,
  conditions: "[]",
  actions: "[]",
  stopProcessing: false,
}

export function NewRuleControl({ triggers, actions }: { triggers: string[]; actions: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="automation-new-rule">
      <button className="still-button still-button-primary" type="button" onClick={() => setOpen(value => !value)}>
        {open ? "Close new rule" : "New rule"}
      </button>
      {open ? <RuleEditor initial={NEW_RULE} triggers={triggers} actions={actions} onClose={() => setOpen(false)} /> : null}
    </div>
  )
}

export function RuleControls({ rule, triggers, actions }: { rule: EditableRule & { id: string }; triggers: string[]; actions: string[] }) {
  const router = useRouter()
  const [panel, setPanel] = useState<"edit" | "test" | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  async function toggleStatus() {
    setBusy(true)
    setFeedback(null)
    try {
      await automationRequest(`/api/automations/rules/${encodeURIComponent(rule.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: rule.status === "active" ? "paused" : "active" }),
      })
      router.refresh()
    } catch (cause) {
      setFeedback({ tone: "error", text: messageFrom(cause) })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setFeedback(null)
    try {
      await automationRequest(`/api/automations/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" })
      router.refresh()
    } catch (cause) {
      setFeedback({ tone: "error", text: messageFrom(cause) })
      setBusy(false)
    }
  }

  return (
    <div className="automation-rule-controls">
      <div className="automation-rule-buttons">
        <button className="still-button still-button-secondary" type="button" onClick={() => setPanel(panel === "edit" ? null : "edit")} disabled={busy}>Edit</button>
        <button className="still-button still-button-secondary" type="button" onClick={() => setPanel(panel === "test" ? null : "test")} disabled={busy}>Dry run</button>
        <button className="still-button still-button-secondary" type="button" onClick={() => void toggleStatus()} disabled={busy}>
          {rule.status === "active" ? "Pause" : "Activate"}
        </button>
        {!confirmDelete
          ? <button className="automation-delete-link" type="button" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</button>
          : <div className="automation-delete-confirm"><span>Delete definition and run history?</span><button type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep</button><button type="button" onClick={() => void remove()} disabled={busy}>Delete permanently</button></div>}
      </div>
      {panel === "edit" ? <RuleEditor initial={rule} triggers={triggers} actions={actions} onClose={() => setPanel(null)} /> : null}
      {panel === "test" ? <RuleDryRun rule={rule} onClose={() => setPanel(null)} /> : null}
      <FeedbackLine feedback={feedback} />
    </div>
  )
}

export function ApplySuggestionControl({ runId, targetId, actionCount }: { runId: string; targetId: string; actionCount: number }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  async function apply() {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await automationRequest<{ applied?: unknown[]; updatedRunIds?: string[] }>("/api/automations/runs/apply", {
        method: "POST",
        body: JSON.stringify({ ruleRunIds: [runId], targetId }),
      })
      const appliedCount = result.applied?.length ?? 0
      setConfirming(false)
      setFeedback({ tone: "success", text: appliedCount ? `${appliedCount} suggested ${appliedCount === 1 ? "action" : "actions"} applied.` : "Nothing changed; the suggestion was no longer applicable." })
      router.refresh()
    } catch (cause) {
      setFeedback({ tone: "error", text: messageFrom(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="automation-apply-suggestion">
      {!confirming
        ? <button type="button" onClick={() => setConfirming(true)} disabled={busy}>Review {actionCount} suggested {actionCount === 1 ? "action" : "actions"}</button>
        : <div><span>Apply to this staged item?</span><button type="button" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button><button type="button" onClick={() => void apply()} disabled={busy}>{busy ? "Applying…" : "Apply suggestion"}</button></div>}
      <FeedbackLine feedback={feedback} />
    </div>
  )
}

function RuleEditor({ initial, triggers, actions, onClose }: { initial: EditableRule; triggers: string[]; actions: string[]; onClose: () => void }) {
  const router = useRouter()
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const triggerOptions = triggers.includes(draft.trigger) ? triggers : [draft.trigger, ...triggers]

  function update<K extends keyof EditableRule>(key: K, value: EditableRule[K]) {
    setDraft(current => ({ ...current, [key]: value }))
    setFeedback(null)
  }

  function addAction(type: string) {
    try {
      const parsed = jsonArray(draft.actions, "Actions")
      update("actions", JSON.stringify([...parsed, { type }], null, 2))
    } catch (cause) {
      setFeedback({ tone: "error", text: messageFrom(cause) })
    }
  }

  async function save() {
    setBusy(true)
    setFeedback(null)
    try {
      const payload = {
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        priority: Number(draft.priority),
        conditions: jsonArray(draft.conditions, "Conditions"),
        actions: jsonArray(draft.actions, "Actions"),
      }
      if (!payload.name) throw new Error("Name is required.")
      if (!Number.isFinite(payload.priority)) throw new Error("Priority must be a number.")
      await automationRequest(draft.id ? `/api/automations/rules/${encodeURIComponent(draft.id)}` : "/api/automations/rules", {
        method: draft.id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      })
      setFeedback({ tone: "success", text: draft.id ? "Rule saved." : "Draft rule created." })
      router.refresh()
      if (!draft.id) onClose()
    } catch (cause) {
      setFeedback({ tone: "error", text: messageFrom(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="automation-editor">
      <div className="automation-editor-grid">
        <label><span>Name</span><input value={draft.name} onChange={event => update("name", event.target.value)} /></label>
        <label><span>Trigger</span><select value={draft.trigger} onChange={event => update("trigger", event.target.value)}>{triggerOptions.map(trigger => <option key={trigger}>{trigger}</option>)}</select></label>
        <label className="automation-editor-wide"><span>Description</span><input value={draft.description} onChange={event => update("description", event.target.value)} /></label>
        <label><span>Status</span><select value={draft.status} onChange={event => update("status", event.target.value)}><option>draft</option><option>active</option><option>paused</option></select></label>
        <label><span>Mode</span><select value={draft.mode} onChange={event => update("mode", event.target.value)}><option>suggest</option><option>auto</option><option>block</option><option>dry_run</option></select></label>
        <label><span>Priority</span><input inputMode="numeric" value={draft.priority} onChange={event => update("priority", Number(event.target.value))} /></label>
        <label className="automation-editor-check"><input type="checkbox" checked={draft.stopProcessing} onChange={event => update("stopProcessing", event.target.checked)} /><span>Stop evaluating later rules after a match</span></label>
        <label className="automation-editor-wide"><span>Conditions · JSON array</span><textarea rows={6} value={draft.conditions} onChange={event => update("conditions", event.target.value)} /></label>
        <label className="automation-editor-wide"><span>Actions · JSON array</span><textarea rows={6} value={draft.actions} onChange={event => update("actions", event.target.value)} /></label>
      </div>
      <div className="automation-action-shortcuts"><span>Add registered action</span>{actions.map(action => <button type="button" onClick={() => addAction(action)} key={action}>{humanize(action)}</button>)}</div>
      <div className="automation-editor-actions"><button className="still-button still-button-primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : draft.id ? "Save rule" : "Create draft"}</button><button className="still-button still-button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button></div>
      <FeedbackLine feedback={feedback} />
    </div>
  )
}

function RuleDryRun({ rule, onClose }: { rule: EditableRule & { id: string }; onClose: () => void }) {
  const router = useRouter()
  const [payload, setPayload] = useState(() => samplePayload(rule.trigger))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ matched: boolean; message: string; actionsPlanned?: unknown[] } | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  async function run() {
    setBusy(true)
    setFeedback(null)
    setResult(null)
    try {
      const parsed = JSON.parse(payload) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Payload must be a JSON object.")
      const data = await automationRequest<{ matched: boolean; message: string; actionsPlanned?: unknown[] }>(`/api/automations/rules/${encodeURIComponent(rule.id)}/test`, {
        method: "POST",
        body: JSON.stringify({ payload: parsed }),
      })
      setResult(data)
      router.refresh()
    } catch (cause) {
      setFeedback({ tone: "error", text: messageFrom(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="automation-editor automation-dry-run">
      <div><strong>Dry run against sample input</strong><p>This records an audited dry-run receipt. It evaluates conditions and planned actions without applying anything.</p></div>
      <label><span>Payload · JSON object</span><textarea rows={8} value={payload} onChange={event => setPayload(event.target.value)} /></label>
      <div className="automation-editor-actions"><button className="still-button still-button-primary" type="button" onClick={() => void run()} disabled={busy}>{busy ? "Evaluating…" : "Run without applying"}</button><button className="still-button still-button-secondary" type="button" onClick={onClose} disabled={busy}>Close</button></div>
      {result ? <div className={`automation-test-result ${result.matched ? "automation-test-match" : ""}`}><strong>{result.matched ? "Matched" : "Did not match"}</strong><span>{result.message} · {result.actionsPlanned?.length ?? 0} actions planned</span></div> : null}
      <FeedbackLine feedback={feedback} />
    </div>
  )
}

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  return feedback ? <p className={`automation-control-feedback automation-control-${feedback.tone}`} aria-live="polite">{feedback.text}</p> : null
}

export async function automationRequest<T = unknown>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init.headers } })
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => ({})) as { error?: string | { message?: string } }
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : body.error?.message
    throw new Error(message || "The automation command failed.")
  }
  return body as T
}

export function jsonArray(value: string, label: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error()
    return parsed
  } catch {
    throw new Error(`${label} must be a valid JSON array.`)
  }
}

function samplePayload(trigger: string) {
  const timestamp = "2026-01-01T00:00:00.000Z"
  const payload = trigger === "inbox.accept"
    ? { stagedInteractionId: "sample", interactionId: "sample", personId: null, source: "imessage", sourceId: "sample", itemType: "interaction", type: "message", timestamp, summary: "Sample accepted message" }
    : { stagedInteractionId: "sample", source: "imessage", sourceId: "sample", itemType: "interaction", type: "message", timestamp, summary: "Sample staged message", candidatePersonId: null, priority: 3 }
  return JSON.stringify(payload, null, 2)
}

function messageFrom(cause: unknown) {
  return cause instanceof Error ? cause.message : "The automation command failed."
}

function humanize(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase())
}
