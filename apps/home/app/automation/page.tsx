import { Suspense } from "react"
import {
  getRegisteredAction,
  listRegisteredActions,
  listRegisteredTriggers,
  type ActionAuthorityTier,
  type RuleAction,
  type RuleCondition,
} from "@life-os/automation"
import {
  ruleActionsContract,
  ruleConditionsContract,
} from "@life-os/contracts"
import { db } from "@life-os/db"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { redirect } from "next/navigation"

export const metadata = { title: "Automation · Life OS" }

const AUTHORITY_TIERS: Array<{
  tier: ActionAuthorityTier
  label: string
  description: string
}> = [
  { tier: "observe", label: "Observe", description: "Reads and measures. It never changes the graph." },
  { tier: "safe_auto", label: "Safe auto", description: "Reversible enrichment can run when evidence is strong enough." },
  { tier: "review", label: "Review", description: "Identity, commitments, and conflicts become Inbox proposals." },
  { tier: "confirm", label: "Confirm", description: "Merges, deletes, access, messages, and money always wait for you." },
]

type RuleRow = {
  id: string
  name: string
  description: string | null
  trigger: string
  status: string
  mode: string
  priority: number
  conditions: string
  actions: string
  stopProcessing: boolean
  version: number
  updatedAt: Date
  runs: Array<{
    id: string
    createdAt: Date
    matched: boolean
    status: string
    mode: string
    message: string | null
    targetType: string | null
    actionsPlanned: string | null
    actionsApplied: string | null
    ruleVersion: number
    causationDepth: number
  }>
}

export default function AutomationPage() {
  return (
    <Suspense fallback={<AutomationFallback />}>
      <AutomationContent />
    </Suspense>
  )
}

async function AutomationContent() {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")

  const [rules, ruleCount, runCount, matchedRunCount] = await Promise.all([
    db.rule.findMany({
      where: { workspaceId },
      orderBy: [{ status: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
      take: 200,
      select: {
        id: true,
        name: true,
        description: true,
        trigger: true,
        status: true,
        mode: true,
        priority: true,
        conditions: true,
        actions: true,
        stopProcessing: true,
        version: true,
        updatedAt: true,
        runs: {
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            createdAt: true,
            matched: true,
            status: true,
            mode: true,
            message: true,
            targetType: true,
            actionsPlanned: true,
            actionsApplied: true,
            ruleVersion: true,
            causationDepth: true,
          },
        },
      },
    }),
    db.rule.count({ where: { workspaceId } }),
    db.ruleRun.count({ where: { workspaceId } }),
    db.ruleRun.count({ where: { workspaceId, matched: true } }),
  ])

  const registeredActions = listRegisteredActions()
  const registeredTriggers = listRegisteredTriggers()

  return (
    <main className="stream-page">
      <div className="stream-container">
        <p className="still-eyebrow">Deterministic by design</p>
        <h1 className="stream-heading-title">Automation</h1>
        <p className="stream-intro automation-intro">
          Rules decide when to act. Every action carries its own safety boundary, and the executor—not AI—decides what may change.
        </p>

        <section className="automation-summary" aria-label="Automation summary">
          <Metric label="Rules" value={ruleCount} detail={`${rules.filter(rule => rule.status === "active").length} active`} />
          <Metric label="Runs" value={runCount} detail={runCount === 0 ? "No history yet" : "Recorded decisions"} />
          <Metric label="Matched" value={matchedRunCount} detail={runCount === 0 ? "—" : `${Math.round((matchedRunCount / runCount) * 100)}% of runs`} />
          <Metric label="Capabilities" value={registeredActions.length} detail={`${registeredTriggers.length} live triggers`} />
        </section>

        <section className="automation-section" aria-labelledby="authority-heading">
          <div className="automation-section-heading">
            <div>
              <p className="still-eyebrow">Safety model</p>
              <h2 id="authority-heading">Authority belongs to the action</h2>
            </div>
            <span className="automation-caption">AI may propose; only the executor mutates</span>
          </div>
          <div className="automation-authority-grid">
            {AUTHORITY_TIERS.map((item, index) => (
              <article className={`automation-authority-card automation-authority-${item.tier}`} key={item.tier}>
                <span className="automation-authority-index">{index + 1}</span>
                <h3>{item.label}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="automation-section" aria-labelledby="rules-heading">
          <div className="automation-section-heading">
            <div>
              <p className="still-eyebrow">Workspace rules</p>
              <h2 id="rules-heading">What the system is allowed to do</h2>
            </div>
            <span className="stream-count">{ruleCount} {ruleCount === 1 ? "rule" : "rules"}</span>
          </div>
          {rules.length === 0
            ? <div className="stream-message">No automation rules are configured for this workspace.</div>
            : <div className="automation-rule-list">{rules.map(rule => <RuleCard rule={rule} key={rule.id} />)}</div>}
        </section>

        <section className="automation-section" aria-labelledby="registry-heading">
          <div className="automation-section-heading">
            <div>
              <p className="still-eyebrow">Executor registry</p>
              <h2 id="registry-heading">Live capabilities</h2>
            </div>
            <span className="automation-caption">Code-defined and reviewable</span>
          </div>
          <div className="automation-registry-grid">
            <RegistryList title="Triggers" items={registeredTriggers.map(trigger => ({ name: trigger, detail: "Receives a validated event payload" }))} />
            <RegistryList title="Actions" items={registeredActions.map(action => ({ name: action.type, detail: authorityLabel(action.authorityTier) }))} />
          </div>
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="automation-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function RuleCard({ rule }: { rule: RuleRow }) {
  const conditions = decodeConditions(rule.conditions)
  const actions = decodeActions(rule.actions)
  const lastRun = rule.runs[0]

  return (
    <article className="automation-rule-card">
      <header className="automation-rule-header">
        <div>
          <div className="automation-rule-title-line">
            <h3>{rule.name}</h3>
            <span className={`automation-status automation-status-${rule.status}`}>{rule.status}</span>
            <span className="automation-version">Definition v{rule.version}</span>
          </div>
          <p>{rule.description || `Runs when ${humanize(rule.trigger)} occurs.`}</p>
        </div>
        <div className="automation-rule-meta">
          <span>Priority {rule.priority}</span>
          <time dateTime={rule.updatedAt.toISOString()}>Updated {formatRelativeDate(rule.updatedAt)}</time>
        </div>
      </header>

      <div className="automation-rule-flow" aria-label={`${rule.name} rule flow`}>
        <RuleStage label="When" title={humanize(rule.trigger)} detail={rule.mode === "auto" ? "Automatic evaluation" : `${humanize(rule.mode)} mode`} />
        <span className="automation-flow-arrow" aria-hidden>→</span>
        <RuleStage
          label="If"
          title={conditions.length === 0 ? "Every event" : `${conditions.length} ${conditions.length === 1 ? "condition" : "conditions"}`}
          detail={conditions.length === 0 ? "No filters" : conditions.map(formatCondition).join(" · ")}
        />
        <span className="automation-flow-arrow" aria-hidden>→</span>
        <RuleStage
          label="Then"
          title={actions.length === 0 ? "No actions" : `${actions.length} ${actions.length === 1 ? "action" : "actions"}`}
          detail={actions.map(formatAction).join(" · ") || "Nothing is changed"}
        />
      </div>

      <div className="automation-action-list" aria-label="Action authority">
        {actions.map((action, index) => {
          const authority = getRegisteredAction(action.type)?.authorityTier
          return (
            <span className="automation-action-pill" key={`${action.type}-${index}`}>
              {humanize(action.type)}
              <em className={`automation-tier automation-tier-${authority || "unknown"}`}>{authority ? authorityLabel(authority) : "Unregistered"}</em>
            </span>
          )
        })}
        {rule.stopProcessing ? <span className="automation-action-pill">Stops later rules</span> : null}
      </div>

      <details className="automation-history">
        <summary>
          <span>Run history</span>
          <span>{lastRun ? `${lastRun.status} · v${lastRun.ruleVersion} · ${formatRelativeDate(lastRun.createdAt)}` : "No runs yet"}</span>
        </summary>
        {rule.runs.length === 0
          ? <p className="automation-history-empty">This rule has not evaluated an event yet.</p>
          : <ol>{rule.runs.map(run => <li key={run.id}>
              <time dateTime={run.createdAt.toISOString()}>{formatDate(run.createdAt)}</time>
              <span className={`automation-run-dot automation-run-${run.status}`} aria-hidden />
              <strong>{run.status}{run.matched ? " · matched" : " · no match"}</strong>
              <span className={run.ruleVersion !== rule.version ? "automation-version-stale" : undefined}>
                v{run.ruleVersion}{run.ruleVersion !== rule.version ? ` · current v${rule.version}` : " · current definition"} · depth {run.causationDepth}
              </span>
              <span>{run.message || run.targetType || `${countStoredActions(run.actionsApplied)} applied of ${countStoredActions(run.actionsPlanned)} planned`}</span>
            </li>)}</ol>}
      </details>
    </article>
  )
}

function RuleStage({ label, title, detail }: { label: string; title: string; detail: string }) {
  return <div className="automation-rule-stage"><span>{label}</span><strong>{title}</strong><small>{detail}</small></div>
}

function RegistryList({ title, items }: { title: string; items: Array<{ name: string; detail: string }> }) {
  return <article className="automation-registry"><h3>{title}</h3><ul>{items.map(item => <li key={item.name}><code>{item.name}</code><span>{item.detail}</span></li>)}</ul></article>
}

function AutomationFallback() {
  return <main className="stream-page"><div className="stream-container"><p className="still-eyebrow">Deterministic by design</p><h1 className="stream-heading-title">Automation</h1><div className="stream-message">Loading rules and run history…</div></div></main>
}

function decodeConditions(raw: string): RuleCondition[] {
  try {
    const parsed = ruleConditionsContract.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function decodeActions(raw: string | null): RuleAction[] {
  if (!raw) return []
  try {
    const parsed = ruleActionsContract.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function countStoredActions(raw: string | null) {
  return decodeActions(raw).length
}

function formatCondition(condition: RuleCondition) {
  const value = condition.value === undefined ? "" : ` ${formatValue(condition.value)}`
  return `${condition.field} ${humanize(condition.operator)}${value}`
}

function formatAction(action: RuleAction) {
  const field = action.field ? ` ${action.field}` : ""
  const value = action.value === undefined ? "" : ` to ${formatValue(action.value)}`
  return `${humanize(action.type)}${field}${value}`
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ")
  if (value && typeof value === "object") return "structured value"
  return String(value)
}

function humanize(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase())
}

function authorityLabel(tier: ActionAuthorityTier) {
  return AUTHORITY_TIERS.find(item => item.tier === tier)?.label ?? humanize(tier)
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value)
}

function formatRelativeDate(value: Date) {
  const elapsed = Date.now() - value.getTime()
  const minutes = Math.max(0, Math.floor(elapsed / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value)
}
