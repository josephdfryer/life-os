"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { lifeOsAppUrl } from "@life-os/auth/urls"
import { EventsMark } from "@life-os/ui"

const HOME_CONNECTIONS_URL = `${lifeOsAppUrl("home", "http://localhost:3003")}/admin/connections`

export default function Header() {
  const pathname = usePathname()

  if (pathname === "/login") return null

  return (
    <header
      style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        height: "52px",
        gap: "24px",
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(12px)",
      }}
    >
      <Link
        href="/events"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "9px",
          fontFamily: "var(--font-display)",
          fontSize: "17px",
          fontWeight: 400,
          color: "var(--ink)",
          textDecoration: "none",
        }}
      >
        <EventsMark size={19} style={{ color: "var(--cognac)", display: "block", flexShrink: 0 }} />
        Events
      </Link>

      <nav style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        <NavLink href="/events" label="Timeline" active={pathname === "/events" || (pathname.startsWith("/events/") && !pathname.startsWith("/events/calendar"))} />
        <NavLink href="/events/calendar" label="Calendar" active={pathname.startsWith("/events/calendar")} />
        <NavLink href={HOME_CONNECTIONS_URL} label="Connections" active={pathname.startsWith("/settings/")} external />
      </nav>
    </header>
  )
}

function NavLink({ href, label, active, external }: { href: string; label: string; active: boolean; external?: boolean }) {
  const style = {
    padding: "6px 14px",
    borderRadius: "var(--radius-pill)",
    fontSize: "13px",
    fontWeight: active ? 500 : 400,
    color: active ? "var(--cognac-deep)" : "var(--ink-3)",
    background: active ? "var(--cognac-soft)" : "transparent",
    textDecoration: "none",
  }

  if (external) return <a href={href} style={style}>{label}</a>

  return <Link href={href} style={style}>{label}</Link>
}
