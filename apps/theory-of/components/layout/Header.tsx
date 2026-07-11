"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"

export default function Header() {
  const pathname = usePathname()
  const { data: session } = useSession()

  if (pathname === "/login") return null

  return (
    <header style={{
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
    }}>
      <Link href="/" style={{
        fontFamily: "var(--font-display)",
        fontSize: "17px",
        fontWeight: 400,
        color: "var(--ink)",
        textDecoration: "none",
      }}>
        Context
      </Link>

      <nav style={{ display: "flex", gap: "14px", alignItems: "center" }}>
        <NavLink href="/" label="Theories" active={pathname === "/" || pathname.startsWith("/person")} />
        <NavLink href="/notes" label="Notes" active={pathname.startsWith("/notes")} />
      </nav>

      <span style={{ fontSize: "11px", color: "var(--ink-4)", fontStyle: "italic" }}>
        the declared and interpretive layer
      </span>

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
              borderRadius: "var(--radius-pill)",
              fontSize: "12px",
              color: "var(--ink-3)",
              background: "transparent",
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.1s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = "var(--ink)"
              e.currentTarget.style.borderColor = "var(--ink-3)"
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = "var(--ink-3)"
              e.currentTarget.style.borderColor = "var(--border)"
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
        fontSize: "12px",
        color: active ? "var(--ink)" : "var(--ink-3)",
        fontWeight: active ? 500 : 400,
        textDecoration: "none",
        borderBottom: active ? "1px solid var(--ink-3)" : "1px solid transparent",
        paddingBottom: "2px",
      }}
    >
      {label}
    </Link>
  )
}
