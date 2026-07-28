"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const LINKS = [
  { href: "/", label: "Card" },
  { href: "/combine", label: "Combine" },
  { href: "/train", label: "Train" },
  { href: "/builds", label: "Builds" },
  { href: "/badges", label: "Badges" },
  { href: "/career", label: "Career" },
]

export default function Nav() {
  const pathname = usePathname()
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href))
  return (
    <header className="topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <Link href="/" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="serif" style={{ fontSize: 20, letterSpacing: "-0.01em" }}>Level Up</span>
          <span className="mono mono-faint" style={{ fontSize: 9 }}>IRL PLAYER</span>
        </Link>
        <nav className="mono">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={isActive(l.href) ? "active" : ""}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <a href="https://home.lacollecteur.com" className="mono mono-faint">Life OS ↗</a>
    </header>
  )
}
