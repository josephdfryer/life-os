"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useRef, useEffect } from "react"
import { useSession, signOut } from "next-auth/react"

const IMPORT_ITEMS = [
  { href: "/import", label: "Import Conversations", desc: "Slack, iMessage, email, any chat" },
  { href: "/import/contacts", label: "Import Contacts", desc: "vCard, Google CSV, LinkedIn CSV" },
]

export default function Header() {
  const pathname = usePathname()
  const [importOpen, setImportOpen] = useState(false)

  if (pathname === "/login") return null
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { data: session } = useSession()

  const importActive = pathname === "/import" || pathname.startsWith("/import/")

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setImportOpen(false)
      }
    }
    document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [])

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
      <Link href="/today" style={{
        fontFamily: "'Playfair Display', serif",
        fontSize: "18px",
        fontWeight: 600,
        color: "var(--ink)",
        textDecoration: "none",
        letterSpacing: "-0.01em",
      }}>
        Persons
      </Link>

      <nav style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        {/* Today */}
        <NavLink href="/today" label="Today" active={pathname === "/today"} />

        {/* Contacts */}
        <NavLink href="/contacts" label="Contacts" active={pathname === "/contacts" || (pathname.startsWith("/contacts/") && !pathname.startsWith("/contacts/import"))} />

        {/* Import dropdown */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setImportOpen(o => !o)}
            style={{
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: importActive ? 500 : 400,
              color: importActive ? "var(--accent)" : "var(--ink-3)",
              background: importActive ? "var(--accent-soft)" : "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              transition: "all 0.1s",
            }}
          >
            Import
            <span style={{
              fontSize: "9px",
              opacity: 0.7,
              transform: importOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.15s",
              display: "inline-block",
            }}>▾</span>
          </button>

          {importOpen && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              padding: "6px",
              minWidth: "220px",
              boxShadow: "0 4px 16px rgba(26,24,20,0.10)",
              zIndex: 100,
              animation: "slideUp 0.12s ease",
            }}>
              {IMPORT_ITEMS.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setImportOpen(false)}
                  style={{
                    display: "block",
                    padding: "9px 12px",
                    borderRadius: "7px",
                    textDecoration: "none",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--ink)", marginBottom: "1px" }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--ink-4)" }}>
                    {item.desc}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* User avatar + sign out — pushed to right */}
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
