"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LevelUpMark } from "@life-os/ui"

const LINKS = [
  { href: "/", label: "Character" },
  { href: "/skills/communication", label: "Communication" },
  { href: "/skills/fitness", label: "Fitness" },
  { href: "/career", label: "Journey" },
  { href: "/train", label: "Train" },
]

export default function Nav() {
  const pathname = usePathname()
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <header className="topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 28, minWidth: 0 }}>
        <Link href="/" style={{ display: "flex", alignItems: "baseline", gap: 8, flexShrink: 0 }}>
          <LevelUpMark size={18} className="brand-mark" style={{ alignSelf: "center", flexShrink: 0 }} />
          <span className="brand-title">Level Up</span>
          <span className="brand-sub">Character</span>
        </Link>
        <nav>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={isActive(l.href) ? "active" : ""}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
