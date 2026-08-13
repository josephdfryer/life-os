"use client"

import { useEffect, useState } from "react"
import { Card } from "@life-os/ui"

type Settings = { publicProfileEnabled: boolean; publicSlug: string | null }

export default function PublicProfilePanel({ personId }: { personId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingSlug, setEditingSlug] = useState(false)
  const [slugInput, setSlugInput] = useState("")
  const [slugError, setSlugError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch(`/api/persons/${personId}/public-profile`)
      .then(res => res.json())
      .then(setSettings)
      .catch(() => setSettings({ publicProfileEnabled: false, publicSlug: null }))
  }, [personId])

  async function toggle() {
    if (!settings || saving) return
    const next = !settings.publicProfileEnabled
    setSaving(true)
    try {
      const res = await fetch(`/api/persons/${personId}/public-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) throw new Error()
      setSettings(await res.json())
    } catch {
      // leave settings unchanged on failure
    }
    setSaving(false)
  }

  async function saveSlug() {
    if (!slugInput.trim()) return
    setSaving(true)
    setSlugError(null)
    try {
      const res = await fetch(`/api/persons/${personId}/public-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slugInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setSlugError(data?.error ?? "Couldn't save that link"); setSaving(false); return }
      setSettings(data)
      setEditingSlug(false)
    } catch {
      setSlugError("Couldn't save that link")
    }
    setSaving(false)
  }

  function copyLink() {
    if (!settings?.publicSlug) return
    const url = `${window.location.origin}/profile/${settings.publicSlug}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (!settings) return null

  return (
    <Card style={{ borderRadius: "14px", marginBottom: "20px", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--ink)", marginBottom: "3px" }}>Public profile</div>
          <div style={{ fontSize: "11px", color: "var(--ink-3)" }}>
            A shareable digital business card — name, title, company, and links only. Never emails, phone numbers, or notes.
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={saving}
          aria-pressed={settings.publicProfileEnabled}
          style={{
            flexShrink: 0,
            width: "38px",
            height: "22px",
            borderRadius: "999px",
            border: "none",
            background: settings.publicProfileEnabled ? "var(--accent)" : "var(--border)",
            position: "relative",
            cursor: "pointer",
            opacity: saving ? 0.6 : 1,
            transition: "background 0.15s",
            padding: 0,
          }}
        >
          <span style={{
            position: "absolute",
            top: "2px",
            left: settings.publicProfileEnabled ? "18px" : "2px",
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
            transition: "left 0.15s",
          }} />
        </button>
      </div>

      {settings.publicProfileEnabled && settings.publicSlug && (
        <div style={{ padding: "12px 20px 16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "8px" }}>
          {editingSlug ? (
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>/profile/</span>
              <input
                autoFocus
                value={slugInput}
                onChange={e => setSlugInput(e.target.value)}
                style={{ flex: 1, fontSize: "12px", fontFamily: "inherit", padding: "5px 8px", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--bg)", color: "var(--ink)" }}
              />
              <button onClick={saveSlug} disabled={saving} style={{ fontSize: "11px", color: "var(--accent)", background: "transparent", border: "1px solid var(--accent)", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", fontFamily: "inherit" }}>Save</button>
              <button onClick={() => { setEditingSlug(false); setSlugError(null) }} style={{ fontSize: "11px", color: "var(--ink-4)", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <a href={`/profile/${settings.publicSlug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "var(--accent)", textDecoration: "none" }}>
                /profile/{settings.publicSlug} ↗
              </a>
              <button onClick={copyLink} style={{ fontSize: "11px", color: "var(--ink-3)", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>
                {copied ? "Copied!" : "Copy link"}
              </button>
              <button onClick={() => { setSlugInput(settings.publicSlug ?? ""); setEditingSlug(true) }} style={{ fontSize: "11px", color: "var(--ink-4)", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>
                Edit link
              </button>
            </div>
          )}
          {slugError && <div style={{ fontSize: "11px", color: "#b91c1c" }}>{slugError}</div>}
        </div>
      )}
    </Card>
  )
}
