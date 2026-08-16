"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useRef, useEffect } from "react"

const IMPORT_ITEMS = [
  { href: "/import/interactions", label: "Import Interactions", desc: "Gmail, Slack, iMessage, notes" },
  { href: "/import/persons", label: "Import Persons", desc: "vCard, Google CSV, LinkedIn CSV" },
]

export default function Header() {
  const pathname = usePathname()
  const [importOpen, setImportOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

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

  if (pathname === "/login" || pathname?.startsWith("/profile/")) return null

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
      <Link href="/today" style={{
        fontFamily: "var(--font-display)",
        fontSize: "17px",
        fontWeight: 400,
        color: "var(--ink)",
        textDecoration: "none",
      }}>
        Persons
      </Link>

      <nav style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        {/* Today */}
        <NavLink href="/today" label="Today" active={pathname === "/today"} />

        {/* Persons */}
        <NavLink href="/persons" label="Persons" active={pathname === "/persons" || (pathname.startsWith("/persons/") && !pathname.startsWith("/persons/notes")) || pathname === "/people" || pathname.startsWith("/people/") || pathname === "/contacts" || pathname.startsWith("/contacts/")} />

        <NavLink href="/persons/notes" label="Notes" active={pathname === "/persons/notes" || pathname.startsWith("/persons/notes/")} />

        <NavLink href="/inbox" label="Inbox" active={pathname === "/inbox"} />

        {/* Import dropdown */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setImportOpen(o => !o)}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-pill)",
              fontSize: "13px",
              fontWeight: importActive ? 500 : 400,
              color: importActive ? "var(--cognac-deep)" : "var(--ink-3)",
              background: importActive ? "var(--cognac-soft)" : "transparent",
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
              border: "1px solid var(--border-subtle)",
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
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover)")}
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
