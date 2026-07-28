"use client"

import { useEffect, useState } from "react"
import type { Person } from "@/types"
import { parseTags } from "@/lib/utils"

type Props = {
  person: Person
  onClose: () => void
  onSaved: () => void
}

type MergeCandidate = {
  id: string
  first: string
  last: string
  nickname: string | null
  company: string | null
  emails: string[]
  phones: string[]
}

export default function EditPersonModal({ person, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    first: person.first,
    last: person.last,
    nickname: person.nickname ?? "",
    title: person.title ?? "",
    headline: person.headline ?? "",
    company: person.company ?? "",
    location: person.location ?? "",
    birthday: person.birthday ?? "",
    closeness: person.closeness,
    tags: parseTags(person.tags as unknown as string).join(", "),
    notes: person.notes ?? "",
    linkedin: person.linkedin ?? "",
    twitter: person.twitter ?? "",
    website: person.website ?? "",
    facebook: person.facebook ?? "",
    instagram: person.instagram ?? "",
  })
  const [emails, setEmails] = useState<string[]>(
    person.emails.length > 0 ? person.emails : [""]
  )
  const [phones, setPhones] = useState<string[]>(
    person.phones.length > 0 ? person.phones : [""]
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMerge, setShowMerge] = useState(false)
  const [mergeQuery, setMergeQuery] = useState("")
  const [mergeResults, setMergeResults] = useState<MergeCandidate[]>([])
  const [mergeCandidate, setMergeCandidate] = useState<MergeCandidate | null>(null)
  const [mergeSearching, setMergeSearching] = useState(false)
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)

  useEffect(() => {
    const query = mergeQuery.trim()
    if (!showMerge || query.length < 2 || mergeCandidate) {
      setMergeResults([])
      setMergeSearching(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setMergeSearching(true)
      setMergeError(null)
      try {
        const params = new URLSearchParams({
          q: query,
          excludeId: person.id,
        })
        const res = await fetch(`/api/persons/search?${params}`, { signal: controller.signal })
        if (!res.ok) throw new Error("Search failed")
        const data = await res.json() as { persons?: MergeCandidate[] }
        setMergeResults(data.persons ?? [])
      } catch (searchError) {
        if ((searchError as Error).name !== "AbortError") {
          setMergeError("Could not search people. Please try again.")
        }
      } finally {
        if (!controller.signal.aborted) setMergeSearching(false)
      }
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [mergeCandidate, mergeQuery, person.id, showMerge])

  const set = (k: string, v: string | number) =>
    setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.first.trim() || !form.last.trim()) {
      setError("First and last name are required.")
      return
    }
    setLoading(true)
    setError(null)
    const tags = form.tags
      .split(",")
      .map(t => t.trim())
      .filter(Boolean)
    const res = await fetch(`/api/persons/${person.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        emails: emails.map(e => e.trim()).filter(Boolean),
        phones: phones.map(p => p.trim()).filter(Boolean),
        tags,
      }),
    })
    setLoading(false)
    if (!res.ok) {
      setError("Failed to save. Please try again.")
      return
    }
    onSaved()
  }

  async function handleMerge() {
    if (!mergeCandidate) return
    setMergeLoading(true)
    setMergeError(null)
    try {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keepId: person.id,
          deleteId: mergeCandidate.id,
        }),
      })
      if (!res.ok) throw new Error("Merge failed")
      onSaved()
    } catch {
      setMergeError("Could not merge these people. No records were changed.")
      setMergeLoading(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(26,24,20,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal-panel"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "28px",
          width: "100%",
          maxWidth: "480px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
          <h2 style={{ fontFamily: "var(--font-display), serif", fontSize: "20px", fontWeight: 600, margin: 0, color: "var(--ink)" }}>
            Edit {person.first} {person.last}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: "18px", padding: "4px" }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="First name *" value={form.first} onChange={v => set("first", v)} />
            <Field label="Last name *" value={form.last} onChange={v => set("last", v)} />
          </div>
          <Field label="Nickname" value={form.nickname} onChange={v => set("nickname", v)} placeholder="e.g. Bobby" />
          <Field label="Title" value={form.title} onChange={v => set("title", v)} />
          <Field label="Headline" value={form.headline} onChange={v => set("headline", v)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="Company" value={form.company} onChange={v => set("company", v)} />
            <Field label="Location" value={form.location} onChange={v => set("location", v)} />
          </div>

          <MultiField
            label="Email"
            values={emails}
            onChange={setEmails}
            placeholder="email@example.com"
            type="email"
          />
          <MultiField
            label="Phone"
            values={phones}
            onChange={setPhones}
            placeholder="+1 (555) 000-0000"
            type="tel"
          />

          <Field label="Birthday" value={form.birthday} onChange={v => set("birthday", v)} placeholder="MM-DD or YYYY-MM-DD" />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="LinkedIn" value={form.linkedin} onChange={v => set("linkedin", v)} placeholder="linkedin.com/in/…" />
            <Field label="Twitter / X" value={form.twitter} onChange={v => set("twitter", v)} placeholder="@handle or URL" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="Facebook" value={form.facebook} onChange={v => set("facebook", v)} placeholder="facebook.com/…" />
            <Field label="Instagram" value={form.instagram} onChange={v => set("instagram", v)} placeholder="@handle or URL" />
          </div>
          <Field label="Website" value={form.website} onChange={v => set("website", v)} placeholder="https://…" />

          <div>
            <label style={labelStyle}>Closeness</label>
            <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
              {([
                [1, "Acquaintance"],
                [2, "Nurture"],
                [3, "Friend"],
                [4, "Inner Circle"],
              ] as [number, string][]).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => set("closeness", val)}
                  style={{
                    flex: 1,
                    padding: "7px 4px",
                    borderRadius: "6px",
                    border: `1px solid ${form.closeness === val ? "var(--accent)" : "var(--border)"}`,
                    background: form.closeness === val ? "var(--accent-soft)" : "var(--surface2)",
                    color: form.closeness === val ? "var(--accent)" : "var(--ink-3)",
                    fontSize: "10px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <Field label="Tags (comma separated)" value={form.tags} onChange={v => set("tags", v)} />
          <Field label="Notes" value={form.notes} onChange={v => set("notes", v)} multiline />

          {showMerge ? (
            <section
              aria-labelledby="merge-person-heading"
              style={{
                padding: "16px",
                background: "var(--surface-2)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
                <div>
                  <h3 id="merge-person-heading" style={{ margin: 0, color: "var(--ink)", fontSize: "13px", fontWeight: 500 }}>
                    Merge with another person
                  </h3>
                  <p style={{ margin: "4px 0 12px", color: "var(--ink-3)", fontSize: "11px", lineHeight: 1.5 }}>
                    {person.first} {person.last} will remain. The other record and its history will be combined into this one.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close merge search"
                  onClick={() => {
                    setShowMerge(false)
                    setMergeCandidate(null)
                    setMergeQuery("")
                    setMergeError(null)
                  }}
                  style={iconButtonStyle}
                >
                  ×
                </button>
              </div>

              {mergeCandidate ? (
                <div>
                  <div style={selectedCandidateStyle}>
                    <div>
                      <strong style={{ display: "block", color: "var(--ink)", fontFamily: "var(--font-display)", fontSize: "16px", fontWeight: 400 }}>
                        {mergeCandidate.first} {mergeCandidate.last}
                      </strong>
                      <span style={{ color: "var(--ink-3)", fontSize: "11px" }}>
                        {candidateDetail(mergeCandidate)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMergeCandidate(null)}
                      disabled={mergeLoading}
                      style={textButtonStyle}
                    >
                      Change
                    </button>
                  </div>
                  <p style={{ margin: "12px 0", color: "var(--ink-2)", fontSize: "11px", lineHeight: 1.5 }}>
                    This permanently removes the selected duplicate after moving its information and linked records to {person.first} {person.last}.
                  </p>
                  <button
                    type="button"
                    onClick={handleMerge}
                    disabled={mergeLoading}
                    style={mergeConfirmButtonStyle}
                  >
                    {mergeLoading ? "Merging…" : `Merge into ${person.first} ${person.last}`}
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    autoFocus
                    type="search"
                    value={mergeQuery}
                    onChange={event => setMergeQuery(event.target.value)}
                    placeholder="Search by name, email, or company"
                    aria-label="Search for a person to merge"
                    style={inputStyle}
                  />
                  <div aria-live="polite" style={{ marginTop: "8px" }}>
                    {mergeSearching ? (
                      <p style={mergeStatusStyle}>Searching…</p>
                    ) : mergeQuery.trim().length > 1 && mergeResults.length === 0 && !mergeError ? (
                      <p style={mergeStatusStyle}>No other people found.</p>
                    ) : (
                      mergeResults.map(candidate => (
                        <button
                          key={candidate.id}
                          type="button"
                          onClick={() => setMergeCandidate(candidate)}
                          style={candidateButtonStyle}
                        >
                          <span style={{ color: "var(--ink)", fontFamily: "var(--font-display)", fontSize: "15px" }}>
                            {candidate.first} {candidate.last}
                          </span>
                          <span style={{ color: "var(--ink-3)", fontSize: "10px" }}>
                            {candidateDetail(candidate)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {mergeError && <p role="alert" style={{ color: "var(--attention)", fontSize: "11px", margin: "10px 0 0" }}>{mergeError}</p>}
            </section>
          ) : null}

          {error && <p style={{ color: "var(--accent)", fontSize: "12px", margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
            <button
              type="button"
              onClick={() => setShowMerge(true)}
              disabled={loading || mergeLoading}
              style={mergeButtonStyle}
            >
              Merge with another person
            </button>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" onClick={onClose} disabled={mergeLoading} style={cancelBtnStyle}>Cancel</button>
              <button type="submit" disabled={loading || mergeLoading} style={submitBtnStyle}>{loading ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function candidateDetail(candidate: MergeCandidate) {
  return candidate.nickname
    || candidate.company
    || candidate.emails[0]
    || candidate.phones[0]
    || "No additional details"
}

function MultiField({
  label,
  values,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  type?: string
}) {
  const update = (i: number, v: string) => {
    const next = [...values]
    next[i] = v
    onChange(next)
  }
  const add = () => onChange([...values, ""])
  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i))

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "5px" }}>
        {values.map((v, i) => (
          <div key={i} style={{ display: "flex", gap: "5px", alignItems: "center" }}>
            <input
              type={type}
              value={v}
              onChange={e => update(i, e.target.value)}
              placeholder={i === 0 ? placeholder : undefined}
              style={inputStyle}
            />
            {values.length > 1 && (
              <button
                type="button"
                onClick={() => remove(i)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", fontSize: "16px", lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", fontSize: "11px", padding: "2px 0" }}
        >
          + Add {label.toLowerCase()}
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  multiline = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  multiline?: boolean
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontSize: "12px",
  boxSizing: "border-box",
}

const labelStyle: React.CSSProperties = {
  color: "var(--ink-3)",
  fontSize: "10px",
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
}

const cancelBtnStyle: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: "7px",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--ink-2)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "12px",
}

const submitBtnStyle: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: "7px",
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "12px",
  fontWeight: 500,
}

const mergeButtonStyle: React.CSSProperties = {
  padding: "8px 0",
  border: "none",
  background: "transparent",
  color: "var(--cognac)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "11px",
  textAlign: "left",
}

const iconButtonStyle: React.CSSProperties = {
  padding: "0 2px",
  border: "none",
  background: "transparent",
  color: "var(--ink-3)",
  cursor: "pointer",
  fontSize: "18px",
  lineHeight: 1,
}

const textButtonStyle: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "transparent",
  color: "var(--cognac)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "11px",
}

const selectedCandidateStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "12px",
  background: "var(--surface)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-sm)",
}

const candidateButtonStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "2px",
  width: "100%",
  padding: "10px 12px",
  border: "none",
  borderBottom: "1px solid var(--border-subtle)",
  background: "transparent",
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
}

const mergeConfirmButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 18px",
  border: "1px solid var(--cognac)",
  borderRadius: "var(--radius-pill)",
  background: "var(--cognac)",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "12px",
  fontWeight: 500,
}

const mergeStatusStyle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "var(--ink-4)",
  fontSize: "11px",
}
