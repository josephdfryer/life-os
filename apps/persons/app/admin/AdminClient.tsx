"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
const EVENTS_APP_URL = process.env.NEXT_PUBLIC_EVENTS_URL || "http://localhost:3006"

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
type ApprovedEmail = {
  id: string
  email: string
  status: string
  workspaceId: string | null
  createdAt: string
  workspace: { id: string; name: string; slug: string } | null
  invitedBy: { id: string; email: string; name: string | null } | null
}
type Workspace = {
  id: string
  name: string
  slug: string
  status: string
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
type Rule = {
  id: string
  name: string
  description: string | null
  trigger: string
  status: string
  priority: number
  mode: string
  conditions: unknown[]
  actions: unknown[]
  stopProcessing: boolean
  lastRun: { createdAt: string; matched: boolean; status: string; message: string | null } | null
}
type RuleRun = {
  id: string
  createdAt: string
  trigger: string
  targetType: string | null
  targetId: string | null
  matched: boolean
  mode: string
  status: string
  message: string | null
  actionsPlanned: unknown
  actionsApplied: unknown
  rule: { id: string; name: string; trigger: string }
}
type CalendarStatus = {
  configured: boolean
  redirectUri: string
  connection: {
    id: string
    status: string
    accountEmail: string | null
    calendarId: string
    calendarSummary: string | null
    scope: string | null
    syncToken: string | null
    lastSyncedAt: string | null
    lastError: string | null
    updatedAt: string
    eventCount: number
  } | null
}
type CalendarTrace = {
  connection: {
    id: string
    calendarId: string
    accountEmail: string | null
    calendarSummary: string | null
  } | null
  runs: {
    id: string
    createdAt: string
    actorLabel: string | null
    metadata: Record<string, unknown> | null
  }[]
  events: {
    id: string
    status: string
    calendarId: string
    externalEventId: string
    iCalUID: string | null
    createdAt: string
    updatedAt: string
    lastSeenAt: string | null
    event: {
      id: string
      name: string
      timestamp: string
      createdAt: string
      htmlLink: string | null
      location: string | null
      attendeeCount: number
      attendees: { email?: string | null; displayName?: string | null; responseStatus?: string | null; self?: boolean }[]
    } | null
    linkedPeople: {
      id: string
      createdAt: string
      timestamp: string
      summary: string | null
      person: { id: string; name: string; emails: string[] } | null
    }[]
  }[]
}
type GmailStatus = {
  configured: boolean
  redirectUri: string
  connection: {
    id: string
    status: string
    accountEmail: string | null
    mailboxId: string
    scope: string | null
    historyId: string | null
    lastSyncedAt: string | null
    lastError: string | null
    updatedAt: string
    messageCount: number
  } | null
}
type GmailTrace = {
  connection: {
    id: string
    mailboxId: string
    accountEmail: string | null
  } | null
  runs: {
    id: string
    createdAt: string
    actorLabel: string | null
    metadata: Record<string, unknown> | null
  }[]
  messages: {
    id: string
    status: string
    mailboxId: string
    externalMessageId: string
    threadId: string | null
    historyId: string | null
    createdAt: string
    updatedAt: string
    lastSeenAt: string | null
    subject: string | null
    snippet: string | null
    from: { name: string | null; email: string }[]
    to: { name: string | null; email: string }[]
    linkedPeople: {
      id: string
      createdAt: string
      timestamp: string
      summary: string | null
      direction: string | null
      person: { id: string; name: string; emails: string[] } | null
    }[]
    stagedItem: {
      id: string
      status: string
      createdAt: string
      updatedAt: string
      timestamp: string
      contactName: string | null
      contactEmail: string | null
      summary: string | null
      direction: string | null
      candidatePerson: { id: string; name: string; emails: string[] } | null
    } | null
  }[]
}
type Overview = {
  currentUser: { id: string; email: string; scopes: string[] }
  users: User[]
  roles: Role[]
  permissions: Permission[]
  apiKeys: ApiKey[]
  auditCount: number
  approvedEmails: ApprovedEmail[]
  workspaces: Workspace[]
}

const TABS = ["apiKeys", "roles", "rules", "permissions", "audit", "workspace", "calendar", "gmail"] as const
type Tab = typeof TABS[number]
const CALENDAR_BACKFILL_OPTIONS = [
  { value: "30", label: "Past 30 days" },
  { value: "90", label: "Past 90 days" },
  { value: "180", label: "Past 6 months" },
  { value: "365", label: "Past year" },
  { value: "730", label: "Past 2 years" },
  { value: "3650", label: "Past 10 years" },
] as const
const GMAIL_BACKFILL_OPTIONS = [
  { value: "7", label: "Past 7 days" },
  { value: "30", label: "Past 30 days" },
  { value: "90", label: "Past 90 days" },
  { value: "180", label: "Past 6 months" },
  { value: "365", label: "Past year" },
  { value: "730", label: "Past 2 years" },
  { value: "3650", label: "Past 10 years" },
  { value: "36500", label: "All time" },
] as const

const DEFAULT_CONDITIONS = `[
  { "field": "source", "operator": "equals", "value": "imessage" }
]`
const DEFAULT_ACTIONS = `[
  { "type": "suggest", "field": "candidatePersonId", "value": "review" }
]`
const DEFAULT_PAYLOAD = `{
  "source": "imessage",
  "type": "message",
  "contactName": "Jane Example",
  "summary": "Lunch next week"
}`
const TRIGGER_OPTIONS = ["ingest.message", "import.person", "import.interaction", "interaction.create", "interaction.append", "inbox.accept"]
const RUN_STATUS_OPTIONS = ["all", "applied", "blocked", "suggested", "dry_run", "skipped", "planned"]
const CONDITION_HELPERS = [
  { label: "source is iMessage", item: { field: "source", operator: "equals", value: "imessage" } },
  { label: "no matched person", item: { field: "candidatePersonId", operator: "not_exists" } },
  { label: "has message text", item: { field: "summary", operator: "exists" } },
  { label: "stressful weight", item: { field: "emotionalWeight", operator: "in", value: ["Draining", "Stressful"] } },
]
const ACTION_HELPERS = [
  { label: "send to review", item: { type: "set", field: "status", value: "pending" } },
  { label: "block record", item: { type: "block" } },
  { label: "set match note", item: { type: "set", field: "matchReason", value: "Needs human review" } },
  { label: "suggest follow-up", item: { type: "suggest", field: "followUp", value: "Review cadence or create a plan" } },
]
const RULE_TEMPLATES = [
  {
    name: "Review unknown iMessages",
    description: "When an iMessage staging item has no candidate person, mark it for human review.",
    trigger: "ingest.message",
    mode: "auto",
    priority: "100",
    stopProcessing: false,
    conditions: [
      { field: "source", operator: "equals", value: "imessage" },
      { field: "candidatePersonId", operator: "not_exists" },
    ],
    actions: [
      { type: "set", field: "matchReason", value: "Needs review: no confident person match" },
      { type: "set", field: "status", value: "pending" },
    ],
    payload: {
      source: "imessage",
      type: "message",
      contactName: "Jane Example",
      summary: "Lunch next week",
    },
  },
  {
    name: "Block empty staged messages",
    description: "Keep empty automation records out of the review queue.",
    trigger: "ingest.message",
    mode: "block",
    priority: "20",
    stopProcessing: true,
    conditions: [
      { field: "summary", operator: "not_exists" },
    ],
    actions: [
      { type: "block" },
    ],
    payload: {
      source: "imessage",
      type: "message",
      contactName: "Jane Example",
      summary: "",
    },
  },
  {
    name: "Review draining imports",
    description: "Surface imported interactions that may need a follow-up plan.",
    trigger: "import.interaction",
    mode: "suggest",
    priority: "120",
    stopProcessing: false,
    conditions: [
      { field: "emotionalWeight", operator: "in", value: ["Draining", "Stressful"] },
    ],
    actions: [
      { type: "suggest", field: "followUp", value: "Review cadence or create a plan" },
    ],
    payload: {
      personName: "Jane Example",
      type: "message",
      emotionalWeight: "Stressful",
      summary: "Follow-up needed after a tense exchange",
    },
  },
] as const

export default function AdminClient({
  initialOverview,
  initialError = null,
}: {
  initialOverview: Overview | null
  initialError?: string | null
}) {
  const [overview, setOverview] = useState<Overview | null>(initialOverview)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [ruleRuns, setRuleRuns] = useState<RuleRun[]>([])
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null)
  const [calendarTrace, setCalendarTrace] = useState<CalendarTrace | null>(null)
  const [calendarSyncResult, setCalendarSyncResult] = useState<string | null>(null)
  const [calendarBackfillDays, setCalendarBackfillDays] = useState("180")
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null)
  const [gmailTrace, setGmailTrace] = useState<GmailTrace | null>(null)
  const [gmailSyncResult, setGmailSyncResult] = useState<string | null>(null)
  const [gmailBackfillDays, setGmailBackfillDays] = useState("30")
  const [gmailUnmatchedMode, setGmailUnmatchedMode] = useState<"skip" | "stage">("skip")
  const [tab, setTab] = useState<Tab>("apiKeys")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [newSecret, setNewSecret] = useState<string | null>(null)

  const [keyName, setKeyName] = useState("")
  const [keyScopes, setKeyScopes] = useState<string[]>(["people.read", "interactions.read"])
  const [roleName, setRoleName] = useState("")
  const [roleKey, setRoleKey] = useState("")
  const [roleDescription, setRoleDescription] = useState("")
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(initialOverview?.roles[0]?.id ?? null)
  const [selectedRoleScopes, setSelectedRoleScopes] = useState<string[]>([])
  const [userRoleDraft, setUserRoleDraft] = useState<Record<string, string[]>>(() => userRolesDraft(initialOverview))
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null)
  const [ruleName, setRuleName] = useState("")
  const [ruleDescription, setRuleDescription] = useState("")
  const [ruleTrigger, setRuleTrigger] = useState("ingest.message")
  const [ruleStatus, setRuleStatus] = useState("active")
  const [ruleMode, setRuleMode] = useState("suggest")
  const [rulePriority, setRulePriority] = useState("100")
  const [ruleStopProcessing, setRuleStopProcessing] = useState(false)
  const [ruleConditions, setRuleConditions] = useState(DEFAULT_CONDITIONS)
  const [ruleActions, setRuleActions] = useState(DEFAULT_ACTIONS)
  const [testPayload, setTestPayload] = useState(DEFAULT_PAYLOAD)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [runFilterRuleId, setRunFilterRuleId] = useState("all")
  const [runFilterTrigger, setRunFilterTrigger] = useState("all")
  const [runFilterMatched, setRunFilterMatched] = useState("all")
  const [runFilterStatus, setRunFilterStatus] = useState("all")

  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteWorkspaceId, setInviteWorkspaceId] = useState("own")

  const selectedRole = useMemo(
    () => overview?.roles.find(role => role.id === selectedRoleId) ?? overview?.roles[0] ?? null,
    [overview?.roles, selectedRoleId],
  )
  const selectedRule = useMemo(
    () => selectedRuleId ? rules.find(rule => rule.id === selectedRuleId) ?? null : null,
    [rules, selectedRuleId],
  )
  const ruleFilterOptions = useMemo(
    () => [
      { value: "all", label: "All rules" },
      ...rules.map(rule => ({ value: rule.id, label: rule.name })),
    ],
    [rules],
  )

  useEffect(() => {
    if (!selectedRole) return
    setSelectedRoleId(selectedRole.id)
    setSelectedRoleScopes(selectedRole.permissions.map(permission => permission.scope))
  }, [selectedRole?.id])

  useEffect(() => {
    if (tab === "audit") loadAudit()
    if (tab === "rules") {
      loadRules()
      loadRuleRuns()
    }
    if (tab === "calendar") {
      loadCalendarStatus()
      loadCalendarTrace()
    }
    if (tab === "gmail") {
      loadGmailStatus()
      loadGmailTrace()
    }
  }, [tab])

  useEffect(() => {
    if (tab === "rules") loadRuleRuns()
  }, [runFilterRuleId, runFilterTrigger, runFilterMatched, runFilterStatus])

  useEffect(() => {
    if (!selectedRule) return
    setSelectedRuleId(selectedRule.id)
    setRuleName(selectedRule.name)
    setRuleDescription(selectedRule.description ?? "")
    setRuleTrigger(selectedRule.trigger)
    setRuleStatus(selectedRule.status)
    setRuleMode(selectedRule.mode)
    setRulePriority(String(selectedRule.priority))
    setRuleStopProcessing(selectedRule.stopProcessing)
    setRuleConditions(JSON.stringify(selectedRule.conditions, null, 2))
    setRuleActions(JSON.stringify(selectedRule.actions, null, 2))
    setTestResult(null)
  }, [selectedRule?.id])

  async function loadOverview() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/access")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not load admin data")
      setOverview(data)
      setSelectedRoleId(data.roles?.[0]?.id ?? null)
      setUserRoleDraft(userRolesDraft(data))
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

  async function loadRules() {
    try {
      const res = await fetch("/api/admin/rules")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not load rules")
      setRules(data.rules ?? [])
      setSelectedRuleId((data.rules ?? [])[0]?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load rules")
    }
  }

  async function loadRuleRuns() {
    try {
      const params = new URLSearchParams()
      if (runFilterRuleId !== "all") params.set("ruleId", runFilterRuleId)
      if (runFilterTrigger !== "all") params.set("trigger", runFilterTrigger)
      if (runFilterMatched !== "all") params.set("matched", runFilterMatched)
      if (runFilterStatus !== "all") params.set("status", runFilterStatus)
      const query = params.toString()
      const res = await fetch(`/api/admin/rule-runs${query ? `?${query}` : ""}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not load rule runs")
      setRuleRuns(data.runs ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load rule runs")
    }
  }

  async function loadCalendarStatus() {
    try {
      const res = await fetch("/api/calendar/google/status")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not load calendar status")
      setCalendarStatus(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load calendar status")
    }
  }

  async function loadCalendarTrace() {
    try {
      const res = await fetch("/api/calendar/google/trace?limit=75")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not load calendar trace")
      setCalendarTrace(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load calendar trace")
    }
  }

  async function syncCalendar() {
    setSaving(true)
    setError(null)
    setCalendarSyncResult(null)
    try {
      const res = await fetch("/api/calendar/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backfillDays: Number(calendarBackfillDays) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not sync Google Calendar")
      setCalendarSyncResult(JSON.stringify(data, null, 2))
      await Promise.all([loadCalendarStatus(), loadCalendarTrace()])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sync Google Calendar")
    } finally {
      setSaving(false)
    }
  }

  async function loadGmailStatus() {
    try {
      const res = await fetch("/api/gmail/google/status")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not load Gmail status")
      setGmailStatus(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Gmail status")
    }
  }

  async function loadGmailTrace() {
    try {
      const res = await fetch("/api/gmail/google/trace?limit=75")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not load Gmail trace")
      setGmailTrace(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Gmail trace")
    }
  }

  async function syncGmail() {
    setSaving(true)
    setError(null)
    setGmailSyncResult(null)
    try {
      const res = await fetch("/api/gmail/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backfillDays: Number(gmailBackfillDays), unmatchedMode: gmailUnmatchedMode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not sync Gmail")
      setGmailSyncResult(JSON.stringify(data, null, 2))
      await Promise.all([loadGmailStatus(), loadGmailTrace()])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sync Gmail")
    } finally {
      setSaving(false)
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

  async function createRule() {
    setSaving(true)
    setError(null)
    setTestResult(null)
    try {
      const res = await fetch("/api/admin/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rulePayload()),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not create rule")
      await loadRules()
      setSelectedRuleId(data.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create rule")
    } finally {
      setSaving(false)
    }
  }

  async function updateRule() {
    if (!selectedRule) return
    setSaving(true)
    setError(null)
    setTestResult(null)
    try {
      const res = await fetch(`/api/admin/rules/${selectedRule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rulePayload()),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not update rule")
      await loadRules()
      setSelectedRuleId(data.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update rule")
    } finally {
      setSaving(false)
    }
  }

  async function testCurrentRule() {
    setSaving(true)
    setError(null)
    setTestResult(null)
    try {
      const res = await fetch("/api/admin/rules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleId: selectedRule?.id ?? null,
          rule: selectedRule ? undefined : rulePayload(),
          payload: testPayload,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not test rule")
      setTestResult(JSON.stringify(data, null, 2))
      await loadRuleRuns()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not test rule")
    } finally {
      setSaving(false)
    }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setSaving(true)
    setError(null)
    try {
      const workspaceId = inviteWorkspaceId === "own" ? null : inviteWorkspaceId
      const res = await fetch("/api/admin/approved-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), workspaceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not approve email")
      setInviteEmail("")
      await loadOverview()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve email")
    } finally {
      setSaving(false)
    }
  }

  async function updateApprovedEmailStatus(id: string, status: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/approved-emails/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not update approval")
      await loadOverview()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update approval")
    } finally {
      setSaving(false)
    }
  }

  function rulePayload() {
    return {
      name: ruleName,
      description: ruleDescription,
      trigger: ruleTrigger,
      status: ruleStatus,
      mode: ruleMode,
      priority: Number(rulePriority),
      stopProcessing: ruleStopProcessing,
      conditions: ruleConditions,
      actions: ruleActions,
    }
  }

  function resetRuleForm() {
    setSelectedRuleId(null)
    setRuleName("")
    setRuleDescription("")
    setRuleTrigger("ingest.message")
    setRuleStatus("active")
    setRuleMode("suggest")
    setRulePriority("100")
    setRuleStopProcessing(false)
    setRuleConditions(DEFAULT_CONDITIONS)
    setRuleActions(DEFAULT_ACTIONS)
    setTestResult(null)
  }

  function applyRuleTemplate(template: typeof RULE_TEMPLATES[number]) {
    setSelectedRuleId(null)
    setRuleName(template.name)
    setRuleDescription(template.description)
    setRuleTrigger(template.trigger)
    setRuleStatus("active")
    setRuleMode(template.mode)
    setRulePriority(template.priority)
    setRuleStopProcessing(template.stopProcessing)
    setRuleConditions(JSON.stringify(template.conditions, null, 2))
    setRuleActions(JSON.stringify(template.actions, null, 2))
    setTestPayload(JSON.stringify(template.payload, null, 2))
    setTestResult(null)
  }

  function appendCondition(item: unknown) {
    appendJsonArrayItem(ruleConditions, item, setRuleConditions, "conditions")
  }

  function appendAction(item: unknown) {
    appendJsonArrayItem(ruleActions, item, setRuleActions, "actions")
  }

  function focusRunsOnSelectedRule() {
    if (!selectedRule) return
    setRunFilterRuleId(selectedRule.id)
    setRunFilterTrigger("all")
  }

  function appendJsonArrayItem(current: string, item: unknown, onChange: (value: string) => void, field: string) {
    setError(null)
    try {
      const parsed = JSON.parse(current)
      if (!Array.isArray(parsed)) throw new Error("not array")
      onChange(JSON.stringify([...parsed, item], null, 2))
    } catch {
      setError(`${field} must be valid JSON before adding a shortcut`)
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
            <TabButton active={tab === "rules"} onClick={() => setTab("rules")} label="Rules" />
            <TabButton active={tab === "permissions"} onClick={() => setTab("permissions")} label="Permissions" />
            <TabButton active={tab === "audit"} onClick={() => setTab("audit")} label="Audit" />
            <TabButton active={tab === "workspace"} onClick={() => setTab("workspace")} label="Workspace" />
            <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")} label="Calendar" />
            <TabButton active={tab === "gmail"} onClick={() => setTab("gmail")} label="Gmail" />
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

          {!loading && overview && tab === "rules" && (
            <section style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 340px", gap: "18px" }}>
              <Panel title="Rules" meta={`${rules.length} rules`}>
                <button style={{ ...smallButtonStyle, marginBottom: "10px" }} onClick={resetRuleForm}>New Rule</button>
                <div style={{ display: "grid", gap: "7px", marginBottom: "12px" }}>
                  {RULE_TEMPLATES.map(template => (
                    <button key={template.name} style={templateButtonStyle} onClick={() => applyRuleTemplate(template)}>
                      <span style={{ display: "block", fontSize: "11px", color: "var(--ink)", fontWeight: 600 }}>{template.name}</span>
                      <span style={{ display: "block", fontSize: "10px", color: "var(--ink-4)", marginTop: "3px", lineHeight: 1.35 }}>{template.trigger} · {template.mode}</span>
                    </button>
                  ))}
                </div>
                <div style={{ display: "grid", gap: "8px" }}>
                  {rules.map(rule => (
                    <button
                      key={rule.id}
                      onClick={() => setSelectedRuleId(rule.id)}
                      style={{
                        textAlign: "left",
                        border: `1px solid ${rule.id === selectedRule?.id ? "var(--accent)" : "var(--border)"}`,
                        background: rule.id === selectedRule?.id ? "var(--accent-soft)" : "var(--bg)",
                        borderRadius: "8px",
                        padding: "10px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>{rule.name}</span>
                        <StatusPill status={rule.status} />
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "4px" }}>
                        {rule.trigger} · {rule.mode} · p{rule.priority}
                      </div>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title={selectedRule ? "Edit Rule" : "New Rule"} meta={selectedRule?.id.slice(0, 8)}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <Field label="Name" value={ruleName} onChange={setRuleName} placeholder="Stage unknown iMessages" />
                  <SelectField label="Trigger" value={ruleTrigger} onChange={setRuleTrigger} options={TRIGGER_OPTIONS} />
                  <SelectField label="Status" value={ruleStatus} onChange={setRuleStatus} options={["active", "paused", "draft"]} />
                  <SelectField label="Mode" value={ruleMode} onChange={setRuleMode} options={["auto", "suggest", "block", "dry_run"]} />
                  <Field label="Priority" value={rulePriority} onChange={setRulePriority} placeholder="100" />
                  <label style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "20px", fontSize: "11px", color: "var(--ink-3)" }}>
                    <input type="checkbox" checked={ruleStopProcessing} onChange={event => setRuleStopProcessing(event.target.checked)} />
                    Stop after match
                  </label>
                </div>
                <Field label="Description" value={ruleDescription} onChange={setRuleDescription} placeholder="What this rule should do" />
                <HelperRow label="Condition shortcuts">
                  {CONDITION_HELPERS.map(helper => (
                    <button key={helper.label} type="button" style={chipButtonStyle} onClick={() => appendCondition(helper.item)}>
                      {helper.label}
                    </button>
                  ))}
                </HelperRow>
                <CodeField label="Conditions" value={ruleConditions} onChange={setRuleConditions} />
                <HelperRow label="Action shortcuts">
                  {ACTION_HELPERS.map(helper => (
                    <button key={helper.label} type="button" style={chipButtonStyle} onClick={() => appendAction(helper.item)}>
                      {helper.label}
                    </button>
                  ))}
                </HelperRow>
                <CodeField label="Actions" value={ruleActions} onChange={setRuleActions} />
                <div style={{ display: "flex", gap: "8px" }}>
                  <button style={primaryButtonStyle} disabled={saving || !ruleName.trim() || !ruleTrigger.trim()} onClick={selectedRule ? updateRule : createRule}>
                    {selectedRule ? "Save Rule" : "Create Rule"}
                  </button>
                  <button style={smallButtonStyle} disabled={saving} onClick={testCurrentRule}>Dry Run</button>
                </div>
              </Panel>

              <Panel title="Test & Runs" meta={`${ruleRuns.length} runs`}>
                <CodeField label="Payload" value={testPayload} onChange={setTestPayload} />
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "10px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "8px" }}>Run filters</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <SelectOptionField label="Rule" value={runFilterRuleId} onChange={setRunFilterRuleId} options={ruleFilterOptions} />
                    <SelectField label="Trigger" value={runFilterTrigger} onChange={setRunFilterTrigger} options={["all", ...TRIGGER_OPTIONS]} />
                    <SelectField label="Outcome" value={runFilterMatched} onChange={setRunFilterMatched} options={["all", "matched", "skipped"]} />
                    <SelectField label="Status" value={runFilterStatus} onChange={setRunFilterStatus} options={RUN_STATUS_OPTIONS} />
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button style={smallButtonStyle} disabled={saving} onClick={loadRuleRuns}>Refresh</button>
                    <button style={smallButtonStyle} disabled={!selectedRule} onClick={focusRunsOnSelectedRule}>Selected Rule</button>
                  </div>
                </div>
                {testResult && (
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "5px" }}>Result</div>
                    <pre style={preStyle}>{testResult}</pre>
                  </div>
                )}
                <div style={{ display: "grid", gap: "8px", maxHeight: "420px", overflowY: "auto" }}>
                  {ruleRuns.map(run => (
                    <div key={run.id} style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ fontSize: "11px", color: "var(--ink)", fontWeight: 600 }}>{run.rule.name}</span>
                        <span style={{ fontSize: "10px", color: run.matched ? "#526b37" : "var(--ink-4)" }}>{run.matched ? "matched" : "skipped"}</span>
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--ink-4)" }}>
                        {formatDate(run.createdAt)} · {run.status}{run.targetType ? ` · ${run.targetType}${run.targetId ? `:${run.targetId.slice(0, 8)}` : ""}` : ""}
                      </div>
                      {run.message && <div style={{ fontSize: "10px", color: "var(--ink-3)", marginTop: "4px" }}>{run.message}</div>}
                      {(actionCount(run.actionsPlanned) > 0 || actionCount(run.actionsApplied) > 0) && (
                        <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                          {actionCount(run.actionsPlanned) > 0 && <StatusPill status={`${actionCount(run.actionsPlanned)} planned`} />}
                          {actionCount(run.actionsApplied) > 0 && <StatusPill status={`${actionCount(run.actionsApplied)} applied`} />}
                        </div>
                      )}
                    </div>
                  ))}
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

          {!loading && overview && tab === "workspace" && (
            <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "18px" }}>
              <Panel title="Approved Sign-ins" meta={`${overview.approvedEmails.length} emails`}>
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <Th>Email</Th>
                        <Th>Status</Th>
                        <Th>Workspace</Th>
                        <Th>Invited by</Th>
                        <Th>Approved</Th>
                        <Th></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.approvedEmails.map(entry => (
                        <tr key={entry.id}>
                          <Td strong>{entry.email}</Td>
                          <Td><StatusPill status={entry.status} /></Td>
                          <Td>{entry.workspace?.name ?? <span style={{ color: "var(--ink-4)" }}>own workspace</span>}</Td>
                          <Td>{entry.invitedBy?.email ?? "—"}</Td>
                          <Td>{formatDate(entry.createdAt)}</Td>
                          <Td align="right">
                            <button
                              style={smallButtonStyle}
                              disabled={saving}
                              onClick={() => updateApprovedEmailStatus(entry.id, entry.status === "approved" ? "revoked" : "approved")}
                            >
                              {entry.status === "approved" ? "Revoke" : "Re-approve"}
                            </button>
                          </Td>
                        </tr>
                      ))}
                      {overview.approvedEmails.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "center", padding: "18px", fontSize: "11px", color: "var(--ink-4)" }}>No approved emails yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="Approve Email">
                <Field label="Email" value={inviteEmail} onChange={setInviteEmail} placeholder="name@example.com" />
                <label style={{ display: "grid", gap: "5px", marginBottom: "12px" }}>
                  <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>Workspace</span>
                  <select
                    value={inviteWorkspaceId}
                    onChange={event => setInviteWorkspaceId(event.target.value)}
                    style={{ height: "34px", border: "1px solid var(--border)", borderRadius: "7px", background: "var(--bg)", color: "var(--ink)", padding: "0 9px", fontFamily: "inherit", fontSize: "12px" }}
                  >
                    <option value="own">Own workspace (isolated)</option>
                    {overview.workspaces.map(ws => (
                      <option key={ws.id} value={ws.id}>{ws.name}</option>
                    ))}
                  </select>
                </label>
                <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "12px", lineHeight: 1.5 }}>
                  {inviteWorkspaceId === "own"
                    ? "This person gets a clean, private workspace when they first sign in."
                    : `This person will share data in "${overview.workspaces.find(ws => ws.id === inviteWorkspaceId)?.name}".`}
                </div>
                <button style={primaryButtonStyle} disabled={saving || !inviteEmail.trim()} onClick={sendInvite}>
                  Approve
                </button>
              </Panel>
            </section>
          )}

          {!loading && overview && tab === "calendar" && (
            <section>
              <Panel title="Google Calendar moved to Events">
                <div style={{ fontSize: "12px", color: "var(--ink-3)", lineHeight: 1.6, marginBottom: "14px" }}>
                  Calendar connect, sync, and import trace now live in the Events app — the lens for the Event primitive.
                </div>
                <a
                  href={`${EVENTS_APP_URL}/settings/calendar`}
                  style={{ ...primaryLinkStyle, display: "inline-block", textDecoration: "none" }}
                >
                  Open Calendar sync in Events
                </a>
              </Panel>
            </section>
          )}

          {!loading && overview && tab === "gmail" && (
            <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: "18px" }}>
              <Panel title="Gmail" meta={gmailStatus?.connection?.status ?? "not connected"}>
                {!gmailStatus && (
                  <div style={{ fontSize: "12px", color: "var(--ink-3)" }}>Loading Gmail status...</div>
                )}
                {gmailStatus && !gmailStatus.configured && (
                  <div style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "12px", fontSize: "12px", color: "var(--ink-3)", lineHeight: 1.5 }}>
                    Gmail OAuth is not configured yet. Add `GOOGLE_GMAIL_CLIENT_ID` and `GOOGLE_GMAIL_CLIENT_SECRET` in Vercel, or reuse the existing Google OAuth client with Gmail API enabled.
                  </div>
                )}
                {gmailStatus && (
                  <div style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "10px", fontSize: "11px", color: "var(--ink-3)", lineHeight: 1.5, wordBreak: "break-word" }}>
                    <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "4px" }}>Google Cloud redirect URI</div>
                    {gmailStatus.redirectUri}
                  </div>
                )}
                {gmailStatus?.connection ? (
                  <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
                    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "10px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>{gmailStatus.connection.accountEmail ?? "Gmail account"}</div>
                      <div style={{ fontSize: "11px", color: "var(--ink-4)", marginTop: "4px" }}>{gmailStatus.connection.mailboxId}</div>
                      <div style={{ display: "flex", gap: "7px", flexWrap: "wrap", marginTop: "9px" }}>
                        <StatusPill status={gmailStatus.connection.status} />
                        <StatusPill status={`${gmailStatus.connection.messageCount} synced messages`} />
                        {gmailStatus.connection.historyId && <StatusPill status="incremental sync" />}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "8px" }}>
                      <InfoTile label="Last synced" value={formatDate(gmailStatus.connection.lastSyncedAt)} />
                      <InfoTile label="History ID" value={gmailStatus.connection.historyId ?? "Not set"} />
                    </div>
                    {gmailStatus.connection.lastError && (
                      <div style={{ border: "1px solid #d46a3a", background: "#fff3ed", color: "#8f3518", borderRadius: "8px", padding: "10px", fontSize: "11px" }}>
                        {gmailStatus.connection.lastError}
                      </div>
                    )}
                    {gmailSyncResult && (
                      <div>
                        <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "5px" }}>Last sync result</div>
                        <pre style={preStyle}>{gmailSyncResult}</pre>
                      </div>
                    )}
                  </div>
                ) : gmailStatus?.configured ? (
                  <div style={{ fontSize: "12px", color: "var(--ink-3)", lineHeight: 1.5, marginTop: "10px" }}>
                    Connect Gmail to import email into Interactions for People matched by email. Messages without a matching Person go to Inbox for review.
                  </div>
                ) : null}
              </Panel>

              <Panel title="Actions">
                <a href="/api/gmail/google/connect?returnTo=/admin" style={{ ...primaryLinkStyle, display: "block", textAlign: "center", marginBottom: "10px" }}>
                  {gmailStatus?.connection ? "Reconnect Gmail" : "Connect Gmail"}
                </a>
                <SelectOptionField
                  label="Backfill range"
                  value={gmailBackfillDays}
                  onChange={setGmailBackfillDays}
                  options={[...GMAIL_BACKFILL_OPTIONS]}
                />
                <SelectOptionField
                  label="Unmatched email"
                  value={gmailUnmatchedMode}
                  onChange={value => setGmailUnmatchedMode(value === "stage" ? "stage" : "skip")}
                  options={[
                    { value: "skip", label: "Known People only" },
                    { value: "stage", label: "Stage unmatched in Inbox" },
                  ]}
                />
                <button style={primaryButtonStyle} disabled={saving || !gmailStatus?.connection} onClick={syncGmail}>
                  {saving ? "Syncing..." : "Sync now"}
                </button>
                <button style={{ ...smallButtonStyle, width: "100%", marginTop: "9px" }} onClick={loadGmailStatus}>
                  Refresh Status
                </button>
                <div style={{ fontSize: "11px", color: "var(--ink-4)", marginTop: "12px", lineHeight: 1.5 }}>
                  Sync is read-only, batched, and uses Gmail history after the first import. By default, only email involving existing People is imported.
                </div>
              </Panel>

              <div style={{ gridColumn: "1 / -1" }}>
              <Panel title="Sync Trace" meta={gmailTrace ? `${gmailTrace.messages.length} recent messages` : "loading"}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", marginBottom: "10px" }}>
                  <div style={{ fontSize: "11px", color: "var(--ink-4)", lineHeight: 1.45 }}>
                    Recent Gmail imports with their matched People, staged Inbox records, or skipped status.
                  </div>
                  <button style={smallButtonStyle} onClick={loadGmailTrace}>Refresh Trace</button>
                </div>

                {gmailTrace?.runs.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "8px", marginBottom: "12px" }}>
                    {gmailTrace.runs.slice(0, 3).map(run => (
                      <div key={run.id} style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "9px" }}>
                        <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "5px" }}>{formatDate(run.createdAt)}</div>
                        <div style={{ fontSize: "11px", color: "var(--ink-2)", lineHeight: 1.45 }}>{formatGmailSyncRun(run.metadata)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "12px" }}>No Gmail sync runs logged yet.</div>
                )}

                <div style={{ display: "grid", gap: "8px" }}>
                  {(gmailTrace?.messages ?? []).map(message => (
                    <div key={message.id} style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline", marginBottom: "7px" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {message.subject || message.stagedItem?.summary || "Gmail message"}
                          </div>
                          <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "3px" }}>
                            {formatDate(message.lastSeenAt ?? message.updatedAt)} · {message.status} · thread {shortId(message.threadId)}
                          </div>
                        </div>
                        <StatusPill status={message.status} />
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "7px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {formatEmailParties("From", message.from)} {message.to.length ? ` · ${formatEmailParties("To", message.to)}` : ""}
                      </div>
                      <GmailTraceOutcome message={message} />
                      <details style={{ marginTop: "8px" }}>
                        <summary style={{ fontSize: "10px", color: "var(--ink-4)", cursor: "pointer" }}>Message IDs</summary>
                        <div style={{ marginTop: "7px", display: "grid", gap: "5px" }}>
                          <div style={{ fontSize: "10px", color: "var(--ink-4)", wordBreak: "break-word" }}>Gmail message: {message.externalMessageId}</div>
                          {message.threadId && <div style={{ fontSize: "10px", color: "var(--ink-4)", wordBreak: "break-word" }}>Thread: {message.threadId}</div>}
                          {message.historyId && <div style={{ fontSize: "10px", color: "var(--ink-4)", wordBreak: "break-word" }}>History: {message.historyId}</div>}
                          {message.snippet && <div style={{ fontSize: "10px", color: "var(--ink-3)", lineHeight: 1.45 }}>{message.snippet}</div>}
                        </div>
                      </details>
                    </div>
                  ))}
                  {gmailTrace && gmailTrace.messages.length === 0 && (
                    <div style={{ fontSize: "11px", color: "var(--ink-4)", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "10px" }}>
                      No Gmail messages to trace yet.
                    </div>
                  )}
                </div>
              </Panel>
              </div>
            </section>
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

function userRolesDraft(overview: Overview | null) {
  return Object.fromEntries(
    (overview?.users ?? []).map((user: User) => [user.id, user.roles.map(role => role.id)]),
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

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label style={{ display: "grid", gap: "5px", marginBottom: "10px" }}>
      <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
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
      >
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )
}

function SelectOptionField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label style={{ display: "grid", gap: "5px", marginBottom: "10px" }}>
      <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
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
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function HelperRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: "2px 0 8px" }}>
      <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "6px" }}>{label}</div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>{children}</div>
    </div>
  )
}

function CodeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: "grid", gap: "5px", marginBottom: "10px" }}>
      <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>{label}</span>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        rows={7}
        spellCheck={false}
        style={{
          border: "1px solid var(--border)",
          borderRadius: "7px",
          background: "var(--bg)",
          color: "var(--ink)",
          padding: "9px",
          fontFamily: "var(--font-body), monospace",
          fontSize: "11px",
          lineHeight: 1.45,
          resize: "vertical",
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

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", padding: "9px" }}>
      <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "11px", color: "var(--ink-2)", wordBreak: "break-word" }}>{value}</div>
    </div>
  )
}

function TracePeople({ people }: { people: CalendarTrace["events"][number]["linkedPeople"] }) {
  if (!people.length) {
    return <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>No People were matched for this event.</div>
  }
  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
      {people.map(item => item.person ? (
        <a
          key={item.id}
          href={`/people/${item.person.id}`}
          style={{ border: "1px solid #88a06a", color: "#526b37", borderRadius: "999px", padding: "3px 8px", fontSize: "10px", textDecoration: "none", background: "#f3f8ee" }}
        >
          {item.person.name}
        </a>
      ) : null)}
    </div>
  )
}

function GmailTraceOutcome({ message }: { message: GmailTrace["messages"][number] }) {
  if (message.linkedPeople.length) {
    return (
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {message.linkedPeople.map(item => item.person ? (
          <a
            key={`${item.id}-${item.person.id}`}
            href={`/people/${item.person.id}`}
            style={{ border: "1px solid #88a06a", color: "#526b37", borderRadius: "999px", padding: "3px 8px", fontSize: "10px", textDecoration: "none", background: "#f3f8ee" }}
          >
            {item.person.name}
          </a>
        ) : null)}
      </div>
    )
  }

  if (message.stagedItem) {
    return (
      <div style={{ display: "flex", gap: "7px", alignItems: "center", flexWrap: "wrap", fontSize: "11px", color: "var(--ink-3)" }}>
        <a href="/inbox" style={{ ...smallButtonStyle, textDecoration: "none" }}>Open Inbox</a>
        <span>Staged for {message.stagedItem.contactName || message.stagedItem.contactEmail || "review"}</span>
        {message.stagedItem.candidatePerson && <span>candidate: {message.stagedItem.candidatePerson.name}</span>}
      </div>
    )
  }

  if (message.status === "skipped") {
    return <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>Skipped because no existing Person matched and Known People only was selected.</div>
  }

  if (message.status === "deleted") {
    return <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>Google reported this message as deleted.</div>
  }

  return <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>No linked Person or Inbox item is recorded for this message.</div>
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

const primaryLinkStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  lineHeight: "34px",
  textDecoration: "none",
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

const templateButtonStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--ink-2)",
  borderRadius: "8px",
  padding: "8px 9px",
  textAlign: "left",
  fontFamily: "inherit",
  cursor: "pointer",
}

const chipButtonStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--ink-3)",
  borderRadius: "999px",
  padding: "4px 8px",
  fontSize: "10px",
  fontFamily: "inherit",
  cursor: "pointer",
}

const preStyle: React.CSSProperties = {
  margin: 0,
  border: "1px solid var(--border)",
  borderRadius: "8px",
  background: "var(--bg)",
  color: "var(--ink-2)",
  padding: "9px",
  fontFamily: "var(--font-body), monospace",
  fontSize: "10px",
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
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

function formatSyncRun(metadata: Record<string, unknown> | null) {
  if (!metadata) return "Sync run"
  const createdEvents = Number(metadata.createdEvents ?? 0)
  const updatedEvents = Number(metadata.updatedEvents ?? 0)
  const createdInteractions = Number(metadata.createdInteractions ?? 0)
  const fetched = Number(metadata.fetched ?? 0)
  const batches = Number(metadata.batches ?? 0)
  const incremental = metadata.incremental ? "incremental" : "backfill"
  return `${createdEvents} events created, ${updatedEvents} updated, ${createdInteractions} People interactions · ${fetched} fetched in ${batches} batches · ${incremental}`
}

function formatGmailSyncRun(metadata: Record<string, unknown> | null) {
  if (!metadata) return "Sync run"
  const createdInteractions = Number(metadata.createdInteractions ?? 0)
  const updatedInteractions = Number(metadata.updatedInteractions ?? 0)
  const staged = Number(metadata.staged ?? 0)
  const skipped = Number(metadata.skipped ?? 0)
  const deleted = Number(metadata.deleted ?? 0)
  const fetched = Number(metadata.fetched ?? 0)
  const batches = Number(metadata.batches ?? 0)
  const incremental = metadata.incremental ? "incremental" : "backfill"
  return `${createdInteractions} created, ${updatedInteractions} appended, ${staged} staged, ${skipped} skipped, ${deleted} deleted · ${fetched} fetched in ${batches} batches · ${incremental}`
}

function formatEmailParties(label: string, parties: { name: string | null; email: string }[]) {
  if (!parties.length) return `${label}: unknown`
  const names = parties.slice(0, 3).map(party => party.name || party.email).join(", ")
  const more = parties.length > 3 ? ` +${parties.length - 3}` : ""
  return `${label}: ${names}${more}`
}

function shortId(value: string | null) {
  return value ? value.slice(0, 10) : "none"
}

function actionCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}
