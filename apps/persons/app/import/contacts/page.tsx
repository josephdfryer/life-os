"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import type { ParsedContact } from "@/lib/vcard"
import { assignColor } from "@/lib/colors"

type ReviewContact = ParsedContact & {
  closeness: number
  tags: string
  skip: boolean
  colorIdx: number
}

type Step = "upload" | "review" | "done"

export default function ImportContactsPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("upload")
  const [contacts, setContacts] = useState<ReviewContact[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  async function processFile(file: File) {
    setError(null)
    setLoading(true)
    try {
      const content = await file.text()
      const format = file.name.endsWith(".csv") ? "csv" : "vcf"
      const res = await fetch("/api/import/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, format }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to parse file")

      const review: ReviewContact[] = data.contacts.map(
        (c: ParsedContact, i: number) => ({
          ...c,
          closeness: 2,
          tags: "",
          skip: false,
          colorIdx: i,
        })
      )
      setContacts(review)
      setStep("review")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file")
    } finally {
      setLoading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = Array.from(e.dataTransfer.files).find(
      f => f.name.endsWith(".vcf") || f.name.endsWith(".csv")
    )
    if (file) processFile(file)
    else setError("Please drop a .vcf or .csv file.")
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ""
  }

  function update(idx: number, patch: Partial<ReviewContact>) {
    setContacts(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    const toImport = contacts.filter(c => !c.skip)

    try {
      const countRes = await fetch("/api/persons")
      const existing = countRes.ok ? await countRes.json() : []
      const offset = existing.length

      let count = 0
      for (let i = 0; i < toImport.length; i++) {
        const c = toImport[i]
        const { color, colorSoft } = assignColor(offset + i)
        const tags = c.tags.split(",").map(t => t.trim()).filter(Boolean)

        const res = await fetch("/api/persons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first: c.first,
            last: c.last,
            headline: c.headline,
            company: c.company,
            email: c.email,
            phone: c.phone,
            birthday: c.birthday && !c.birthday.startsWith("0000") ? c.birthday : null,
            closeness: c.closeness,
            tags,
            values: [],
            notes: c.notes,
            location: c.location,
            linkedin: c.linkedin,
            twitter: c.twitter,
            website: c.website,
            color,
            colorSoft,
          }),
        })
        if (res.ok) count++
      }

      setSavedCount(count)
      setStep("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setSaving(false)
    }
  }

  const activeCount = contacts.filter(c => !c.skip).length

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto", padding: "32px 24px" }}>
      <a
        href="/import"
        style={{ fontSize: "11px", color: "var(--ink-4)", textDecoration: "none", display: "inline-block", marginBottom: "20px" }}
      >
        ← Import
      </a>

      <div style={{ marginBottom: "28px" }}>
        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: "26px",
          fontWeight: 600,
          color: "var(--ink)",
          margin: "0 0 6px",
        }}>
          Import from Contacts
        </h1>
        <p style={{ color: "var(--ink-3)", fontSize: "12px", margin: 0 }}>
          Export a vCard (.vcf) from Contacts.app, then drop it here.
        </p>
      </div>

      {step === "upload" && (
        <>
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            padding: "16px 18px",
            marginBottom: "20px",
            fontSize: "12px",
            color: "var(--ink-2)",
            lineHeight: 1.7,
          }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "14px", fontWeight: 500, color: "var(--ink)", marginBottom: "6px" }}>
              How to export from Contacts.app
            </div>
            <ol style={{ margin: 0, paddingLeft: "18px" }}>
              <li>Open <strong>Contacts.app</strong></li>
              <li>Select people (⌘-click to multi-select)</li>
              <li><strong>File → Export → Export vCard…</strong></li>
              <li>Save the .vcf file, then drop it below — or export a Google/LinkedIn CSV</li>
            </ol>
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !loading && inputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
              borderRadius: "12px",
              padding: "48px 24px",
              textAlign: "center",
              cursor: loading ? "wait" : "pointer",
              background: dragging ? "var(--accent-soft)" : "var(--surface)",
              transition: "all 0.15s",
            }}
          >
            <input ref={inputRef} type="file" accept=".vcf,.csv" onChange={handleFileInput} style={{ display: "none" }} />
            {loading ? (
              <>
                <div style={{
                  width: "32px", height: "32px",
                  border: "2px solid var(--border)", borderTopColor: "var(--accent)",
                  borderRadius: "50%", animation: "spin 0.8s linear infinite",
                  margin: "0 auto 12px",
                }} />
                <div style={{ color: "var(--ink-3)", fontSize: "12px" }}>Parsing contacts…</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "28px", marginBottom: "10px", color: "var(--ink-4)" }}>↑</div>
                <div style={{ color: "var(--ink)", fontSize: "13px", marginBottom: "5px" }}>Drop your contacts file here</div>
                <div style={{ color: "var(--ink-4)", fontSize: "11px" }}>.vcf  ·  .csv (Google, LinkedIn, generic)</div>
              </>
            )}
          </div>

          {error && <p style={{ color: "var(--accent)", fontSize: "12px", marginTop: "12px" }}>{error}</p>}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      )}

      {step === "review" && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", fontWeight: 600, margin: "0 0 2px", color: "var(--ink)" }}>
                {contacts.length} contact{contacts.length !== 1 ? "s" : ""} found
              </h2>
              <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>
                Expand each card to edit details and set closeness. Skip anyone you don't want to add.
              </div>
            </div>
            <button onClick={() => setStep("upload")} style={ghostBtnStyle}>← Back</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px" }}>
            {contacts.map((c, i) => (
              <ContactReviewCard key={i} contact={c} onChange={patch => update(i, patch)} />
            ))}
          </div>

          {error && <p style={{ color: "var(--accent)", fontSize: "12px", marginBottom: "12px" }}>{error}</p>}

          <button
            onClick={handleConfirm}
            disabled={saving || activeCount === 0}
            style={{
              width: "100%",
              padding: "13px",
              background: activeCount > 0 ? "var(--accent)" : "var(--border)",
              color: activeCount > 0 ? "#fff" : "var(--ink-4)",
              border: "none",
              borderRadius: "8px",
              cursor: activeCount > 0 && !saving ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              fontSize: "13px",
              fontWeight: 500,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Adding contacts…" : `Add ${activeCount} contact${activeCount !== 1 ? "s" : ""} to Persons`}
          </button>
        </>
      )}

      {step === "done" && (
        <div style={{
          textAlign: "center",
          padding: "56px 32px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
        }}>
          <div style={{ fontSize: "30px", marginBottom: "14px" }}>✓</div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "22px", fontWeight: 600, color: "var(--ink)", margin: "0 0 8px" }}>
            {savedCount} contact{savedCount !== 1 ? "s" : ""} added
          </h2>
          <p style={{ color: "var(--ink-3)", fontSize: "12px", marginBottom: "24px" }}>
            They're in Persons now. Log your first interaction whenever you're ready.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            <button
              onClick={() => router.push("/contacts")}
              style={{ padding: "10px 24px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "7px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 500 }}
            >
              View Contacts →
            </button>
            <button
              onClick={() => { setStep("upload"); setContacts([]) }}
              style={{ padding: "10px 24px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "7px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" }}
            >
              Import More
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ContactReviewCard({
  contact,
  onChange,
}: {
  contact: ReviewContact
  onChange: (patch: Partial<ReviewContact>) => void
}) {
  const [open, setOpen] = useState(false)
  const { color } = assignColor(contact.colorIdx)

  const initials = (contact.first[0] ?? "") + (contact.last[0] ?? "")

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${contact.skip ? "var(--border)" : color}`,
      borderRadius: "8px",
      overflow: "hidden",
      opacity: contact.skip ? 0.4 : 1,
      transition: "opacity 0.15s",
    }}>
      {/* Header row */}
      <div
        style={{ display: "flex", alignItems: "center", gap: "12px", padding: "11px 14px", cursor: contact.skip ? "default" : "pointer" }}
        onClick={() => !contact.skip && setOpen(o => !o)}
      >
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: contact.skip ? "var(--surface2)" : `${color}22`,
          color: contact.skip ? "var(--ink-4)" : color,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "11px", fontWeight: 500, flexShrink: 0,
        }}>
          {initials}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--ink)" }}>
            {contact.first} {contact.last}
          </div>
          {(contact.headline || contact.email) && (
            <div style={{ fontSize: "11px", color: "var(--ink-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {contact.headline ?? contact.email}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {!contact.skip && (
            <span style={{ fontSize: "10px", color: "var(--ink-4)", background: "var(--surface2)", padding: "2px 8px", borderRadius: "10px" }}>
              {["", "Acquaintance", "Friend", "Inner Circle"][contact.closeness]}
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onChange({ skip: !contact.skip }) }}
            style={{ fontSize: "10px", padding: "4px 9px", borderRadius: "5px", border: "1px solid var(--border)", background: "transparent", color: "var(--ink-4)", cursor: "pointer", fontFamily: "inherit" }}
          >
            {contact.skip ? "Undo" : "Skip"}
          </button>
          {!contact.skip && (
            <span style={{ color: "var(--ink-4)", fontSize: "11px" }}>{open ? "▾" : "▸"}</span>
          )}
        </div>
      </div>

      {/* Expanded form */}
      {open && !contact.skip && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--border)" }}>
          <div style={{ height: "12px" }} />

          {/* Name */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div>
              <label style={labelStyle}>First Name</label>
              <input
                type="text"
                value={contact.first}
                onChange={e => onChange({ first: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Last Name</label>
              <input
                type="text"
                value={contact.last}
                onChange={e => onChange({ last: e.target.value })}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Headline + Company */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div>
              <label style={labelStyle}>Headline / Role</label>
              <input
                type="text"
                value={contact.headline ?? ""}
                onChange={e => onChange({ headline: e.target.value || null })}
                placeholder="e.g. Product Designer"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Company</label>
              <input
                type="text"
                value={contact.company ?? ""}
                onChange={e => onChange({ company: e.target.value || null })}
                placeholder="e.g. Acme Corp"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Email + Phone */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={contact.email ?? ""}
                onChange={e => onChange({ email: e.target.value || null })}
                placeholder="email@example.com"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input
                type="tel"
                value={contact.phone ?? ""}
                onChange={e => onChange({ phone: e.target.value || null })}
                placeholder="+1 555 000 0000"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Birthday + Location */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div>
              <label style={labelStyle}>Birthday</label>
              <input
                type="text"
                value={contact.birthday && !contact.birthday.startsWith("0000") ? contact.birthday : ""}
                onChange={e => onChange({ birthday: e.target.value || null })}
                placeholder="YYYY-MM-DD"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Location</label>
              <input
                type="text"
                value={contact.location ?? ""}
                onChange={e => onChange({ location: e.target.value || null })}
                placeholder="City, State"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Social + Website */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div>
              <label style={labelStyle}>LinkedIn</label>
              <input
                type="url"
                value={contact.linkedin ?? ""}
                onChange={e => onChange({ linkedin: e.target.value || null })}
                placeholder="linkedin.com/in/…"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Twitter / X</label>
              <input
                type="text"
                value={contact.twitter ?? ""}
                onChange={e => onChange({ twitter: e.target.value || null })}
                placeholder="@handle"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Website</label>
              <input
                type="url"
                value={contact.website ?? ""}
                onChange={e => onChange({ website: e.target.value || null })}
                placeholder="https://…"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Closeness */}
          <div style={{ marginBottom: "12px" }}>
            <label style={labelStyle}>Closeness</label>
            <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
              {([
                [1, "Acquaintance"],
                [2, "Friend"],
                [3, "Inner Circle"],
              ] as [number, string][]).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => onChange({ closeness: val })}
                  style={{
                    flex: 1, padding: "6px 4px", borderRadius: "5px",
                    border: `1px solid ${contact.closeness === val ? "var(--accent)" : "var(--border)"}`,
                    background: contact.closeness === val ? "var(--accent-soft)" : "var(--surface2)",
                    color: contact.closeness === val ? "var(--accent)" : "var(--ink-3)",
                    fontSize: "10px", cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div style={{ marginBottom: "12px" }}>
            <label style={labelStyle}>Tags (comma separated)</label>
            <input
              type="text"
              value={contact.tags}
              onChange={e => onChange({ tags: e.target.value })}
              placeholder="designer, sf, college friend…"
              style={inputStyle}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={contact.notes ?? ""}
              onChange={e => onChange({ notes: e.target.value || null })}
              rows={3}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  color: "var(--ink-3)",
  fontSize: "10px",
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontSize: "12px",
  marginTop: "5px",
  boxSizing: "border-box",
}

const ghostBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--ink-3)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "11px",
}
