"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"

export default function Header() {
  const pathname = usePathname()
  const { data: session } = useSession()

  if (pathname === "/login") return null

  return (
    <header
      style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        height: "52px",
        gap: "32px",
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(12px)",
      }}
    >
      <Link
        href="/events"
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: "18px",
          fontWeight: 600,
          color: "var(--ink)",
          textDecoration: "none",
          letterSpacing: "-0.01em",
        }}
      >
        Events
      </Link>

      <nav style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        <NavLink href="/events" label="Timeline" active={pathname === "/events" || (pathname.startsWith("/events/") && !pathname.startsWith("/events/calendar"))} />
        <NavLink href="/events/calendar" label="Calendar" active={pathname.startsWith("/events/calendar")} />
        <NavLink href="/settings/calendar" label="Sync" active={pathname.startsWith("/settings/calendar")} />
      </nav>

      {session?.user && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
          {session.user.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt={session.user.name ?? ""}
              width={24}
              height={24}
              style={{ borderRadius: "50%", opacity: 0.85 }}
            />
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              fontSize: "11px",
              color: "var(--ink-3)",
              background: "transparent",
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  )
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        padding: "5px 12px",
        borderRadius: "6px",
        fontSize: "12px",
        fontWeight: active ? 500 : 400,
        color: active ? "var(--accent)" : "var(--ink-3)",
        background: active ? "var(--accent-soft)" : "transparent",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  )
}