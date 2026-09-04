import type { ReactNode } from "react"
import type { AdminCapabilities } from "@/lib/admin-access"

export type AdminTab =
  | "overview"
  | "connections"
  | "health"
  | "stream"
  | "automation"
  | "access"
  | "api-keys"
  | "workspace"
  | "audit"
  | "assistant-chats"

const ADMIN_TAB_GROUPS: Array<{
  label: string
  tabs: Array<{ id: AdminTab; label: string; href: string }>
}> = [
  {
    label: "Data",
    tabs: [
      { id: "overview", label: "Overview", href: "/admin" },
      { id: "connections", label: "Connections", href: "/admin/connections" },
      { id: "health", label: "System health", href: "/admin/health" },
      { id: "stream", label: "Stream", href: "/admin/stream" },
    ],
  },
  {
    label: "Control",
    tabs: [
      { id: "automation", label: "Automation", href: "/admin/automation" },
      { id: "access", label: "Access", href: "/admin/access" },
      { id: "api-keys", label: "API keys", href: "/admin/api-keys" },
      { id: "workspace", label: "Workspace", href: "/admin/workspace" },
      { id: "assistant-chats", label: "Assistant chats", href: "/admin/assistant-chats" },
      { id: "audit", label: "Audit log", href: "/admin/audit" },
    ],
  },
]

export function AdminChrome({
  tab,
  children,
  intro = "Connections, credentials, automation, audit, and system health — every stream, last data, and the event spine.",
  capabilities,
}: {
  tab: AdminTab
  children: ReactNode
  intro?: string
  capabilities?: AdminCapabilities | null
}) {
  const visibleTabs = ADMIN_TAB_GROUPS.map(group => ({
    ...group,
    tabs: group.tabs.filter(item => isTabVisible(item.id, capabilities)),
  })).filter(group => group.tabs.length > 0)

  return (
    <main className="stream-page">
      <div className="stream-container">
        <p className="still-eyebrow">The control plane</p>
        <h1 className="stream-heading-title">Admin</h1>
        <p className="stream-intro">{intro}</p>
        <nav className="admin-tabs" aria-label="Admin tabs">
          {visibleTabs.map(group => (
            <div className="admin-tab-group" key={group.label}>
              <span className="admin-tab-group-label">{group.label}</span>
              {group.tabs.map(item => (
                <a key={item.id} className={tab === item.id ? "admin-tab-active" : ""} href={item.href}>
                  {item.label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        {children}
      </div>
    </main>
  )
}

export function AdminFallback() {
  return (
    <main className="stream-page">
      <div className="stream-container">
        <p className="still-eyebrow">The control plane</p>
        <h1 className="stream-heading-title">Admin</h1>
        <div className="stream-message">Loading system records…</div>
      </div>
    </main>
  )
}

function isTabVisible(tab: AdminTab, capabilities?: AdminCapabilities | null) {
  if (!capabilities) return tab === "overview" || tab === "connections" || tab === "health" || tab === "stream"
  if (tab === "automation") return capabilities.automation
  if (tab === "access") return capabilities.access
  if (tab === "api-keys") return capabilities.apiKeys
  if (tab === "workspace" || tab === "audit") return capabilities.workspace || capabilities.audit
  if (tab === "assistant-chats") return capabilities.assistantHistory
  return true
}

export function AdminBreadcrumb({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav className="admin-breadcrumb" aria-label="Admin location">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {index > 0 ? <span aria-hidden className="admin-breadcrumb-sep">/</span> : null}
          {item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
        </span>
      ))}
    </nav>
  )
}
