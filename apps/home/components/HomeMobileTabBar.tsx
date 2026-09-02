"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"

const COMPACT_QUERY = "(max-width: 640px)"

const MORE_LINKS = [
  { label: "Intelligence", path: "/intelligence" },
  { label: "Admin", path: "/admin" },
] as const

function subscribeCompact(onStoreChange: () => void) {
  const media = window.matchMedia(COMPACT_QUERY)
  media.addEventListener("change", onStoreChange)
  return () => media.removeEventListener("change", onStoreChange)
}

function getCompactSnapshot() {
  return window.matchMedia(COMPACT_QUERY).matches
}

function getCompactServerSnapshot() {
  return false
}

function focusAssistant() {
  const panel = document.getElementById("assistant")
  if (!panel) return
  panel.scrollIntoView({ behavior: "smooth", block: "start" })
  const input = panel.querySelector("textarea")
  if (input instanceof HTMLTextAreaElement) {
    window.setTimeout(() => input.focus(), 280)
  }
}

/**
 * Thumb-friendly primary navigation on phone-width Home screens.
 * Replaces cramming Today/Inbox/etc. into the top LifeOSBar.
 */
export default function HomeMobileTabBar() {
  const pathname = usePathname()
  const compact = useSyncExternalStore(subscribeCompact, getCompactSnapshot, getCompactServerSnapshot)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  const [hash, setHash] = useState("")

  const hidden =
    pathname === "/login" ||
    pathname?.startsWith("/profile/") ||
    pathname?.startsWith("/device/")

  const visible = compact && !hidden

  useEffect(() => {
    function syncHash() {
      setHash(window.location.hash)
    }
    syncHash()
    window.addEventListener("hashchange", syncHash)
    return () => window.removeEventListener("hashchange", syncHash)
  }, [pathname])

  useEffect(() => {
    if (!visible) return
    document.body.classList.add("home-mobile-tabs-active")
    return () => document.body.classList.remove("home-mobile-tabs-active")
  }, [visible])

  useEffect(() => {
    if (pathname === "/" && window.location.hash === "#assistant") {
      window.setTimeout(() => focusAssistant(), 120)
    }
  }, [pathname])

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [])

  if (!visible) return null

  const onHome = pathname === "/"
  const onInbox = pathname.startsWith("/inbox")
  const onMoreSection =
    pathname.startsWith("/intelligence") ||
    pathname.startsWith("/admin")

  return (
    <nav
      className={`home-mobile-tab-bar${onHome ? " home-mobile-tab-bar--dashboard" : ""}`}
      aria-label="Home primary navigation"
    >
      <a
        href="/"
        className={`home-mobile-tab${onHome ? " home-mobile-tab--active" : ""}`}
        aria-current={onHome ? "page" : undefined}
      >
        <span className="home-mobile-tab-icon" aria-hidden>◉</span>
        <span>Today</span>
      </a>

      <a
        href="/inbox"
        className={`home-mobile-tab${onInbox ? " home-mobile-tab--active" : ""}`}
        aria-current={onInbox ? "page" : undefined}
      >
        <span className="home-mobile-tab-icon" aria-hidden>◎</span>
        <span>Inbox</span>
      </a>

      <a
        href="/#assistant"
        className={`home-mobile-tab${onHome && hash === "#assistant" ? " home-mobile-tab--active" : ""}`}
        onClick={event => {
          if (onHome) {
            event.preventDefault()
            focusAssistant()
          }
        }}
      >
        <span className="home-mobile-tab-icon" aria-hidden>✦</span>
        <span>Assistant</span>
      </a>

      <div ref={moreRef} className="home-mobile-tab-more">
        <button
          type="button"
          className={`home-mobile-tab home-mobile-tab--button${onMoreSection || moreOpen ? " home-mobile-tab--active" : ""}`}
          aria-label="More LifeOS sections"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(value => !value)}
        >
          <span className="home-mobile-tab-icon" aria-hidden>⋯</span>
          <span>More</span>
        </button>

        {moreOpen && (
          <div className="home-mobile-tab-menu" role="menu">
            {MORE_LINKS.map(item => {
              const active = pathname.startsWith(item.path)
              return (
                <a
                  key={item.path}
                  href={item.path}
                  role="menuitem"
                  className={`home-mobile-tab-menu-item${active ? " home-mobile-tab-menu-item--active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                >
                  {item.label}
                </a>
              )
            })}
            <button
              type="button"
              role="menuitem"
              className="home-mobile-tab-menu-item home-mobile-tab-menu-capture"
              onClick={() => {
                setMoreOpen(false)
                if (onHome) {
                  focusAssistant()
                } else {
                  window.location.href = "/#assistant"
                }
              }}
            >
              Capture
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
