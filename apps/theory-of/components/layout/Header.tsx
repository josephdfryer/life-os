"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

export default function Header() {
  const pathname = usePathname()

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
