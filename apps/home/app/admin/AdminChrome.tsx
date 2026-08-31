import type { ReactNode } from "react"

export type AdminTab = "overview" | "stream" | "health" | "api-keys" | "access" | "workspace" | "audit"

const ADMIN_TABS: Array<{ id: AdminTab; label: string; href: string }> = [
  { id: "overview", label: "Overview", href: "/admin" },
  { id: "stream", label: "Stream", href: "/admin/stream" },
  { id: "health", label: "System health", href: "/admin/health" },
  { id: "api-keys", label: "API keys", href: "/admin?tab=api-keys" },
  { id: "access", label: "Access", href: "/admin?tab=access" },
  { id: "workspace", label: "Workspace", href: "/admin?tab=workspace" },
  { id: "audit", label: "Audit log", href: "/admin?tab=audit" },
]

export function AdminChrome({
  tab,
  children,
  intro = "Access, credentials, audit, and system health — every stream, last data, and the event spine.",
}: {
  tab: AdminTab
  children: ReactNode
  intro?: string
}) {
  return (
    <main className="stream-page">
      <div className="stream-container">
        <p className="still-eyebrow">The control plane</p>
        <h1 className="stream-heading-title">Admin</h1>
        <p className="stream-intro">{intro}</p>
        <nav className="admin-tabs" aria-label="Admin tabs">
          {ADMIN_TABS.map(item => (
            <a key={item.id} className={tab === item.id ? "admin-tab-active" : ""} href={item.href}>
              {item.label}
            </a>
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
