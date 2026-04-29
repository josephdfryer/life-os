"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useRef, useEffect, useState } from "react"
import { useSession, signOut } from "next-auth/react"

export default function Header() {
  const pathname = usePathname()
  const { data: session } = useSession()

  if (pathname === "/login") return null

  return (
    <header style={{
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
    }}>
      <Link href="/items" style={{
        fontFamily: "var(--font-playfair), serif",
        fontSize: "18px",
        fontWeight: 600,
        color: "var(--ink)",
        textDecoration: "none",
        letterSpacing: "-0.01em",
      }}>
        Stuff
      </Link>

      <nav style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        <NavLink href="/items"   label="Items"   active={pathname === "/items" || pathname.startsWith("/items/")} />
        <NavLink href="/places"  label="Places"  active={pathname === "/places" || pathname.startsWith("/places/")} />
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
        padding: "5px 12px",
        borderRadius: "6px",
        fontSize: "12px",
        fontWeight: active ? 500 : 400,
        color: active ? "var(--accent)" : "var(--ink-3)",
        background: active ? "var(--accent-soft)" : "transparent",
        textDecoration: "none",
        transition: "all 0.1s",
      }}
    >
      {label}
    </Link>
  )
}
