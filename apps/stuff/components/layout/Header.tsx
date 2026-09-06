"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { StuffMark } from "@life-os/ui"

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
      minHeight: "var(--nav-height, 52px)",
      gap: "12px 24px",
      flexWrap: "wrap",
      position: "sticky",
      // Sit under the shared LifeOSBar rather than behind it.
      top: "var(--lifeos-bar-height, 40px)",
      zIndex: 50,
    }}>
      <Link href="/items" style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "9px",
        fontFamily: "var(--font-display)",
        fontSize: "17px",
        fontWeight: 400,
        color: "var(--ink)",
        textDecoration: "none",
      }}>
        <StuffMark size={19} style={{ color: "var(--cognac)", display: "block", flexShrink: 0 }} />
        Stuff
      </Link>

      <nav style={{ display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
        <NavLink href="/items"   label="Items"   active={pathname === "/items" || pathname.startsWith("/items/")} />
        <NavLink href="/inventory" label="Inventory" active={pathname === "/inventory" || pathname.startsWith("/inventory/")} />
        <NavLink href="/wardrobe" label="Wardrobe" active={pathname === "/wardrobe" || pathname.startsWith("/wardrobe/")} />
      </nav>

    </header>
  )
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        padding: "6px 14px",
        borderRadius: "var(--radius-pill)",
        fontSize: "13px",
        fontWeight: active ? 500 : 400,
        color: active ? "var(--cognac-deep)" : "var(--ink-3)",
        background: active ? "var(--cognac-soft)" : "transparent",
        textDecoration: "none",
        transition: "all 0.1s",
      }}
    >
      {label}
    </Link>
  )
}
