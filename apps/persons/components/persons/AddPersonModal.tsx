"use client"

import { useState } from "react"
import { assignColor } from "@/lib/colors"

type Props = {
  onClose: () => void
  onSaved: () => void
  totalPersons: number
}

export default function AddPersonModal({ onClose, onSaved, totalPersons }: Props) {
  const [form, setForm] = useState({
    first: "",
    last: "",
    title: "",
    headline: "",
    company: "",
    location: "",
    birthday: "",
    closeness: 2,
    tags: "",
    notes: "",
  })
  const [emails, setEmails] = useState<string[]>([""])
  const [phones, setPhones] = useState<string[]>([""])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    const { color, colorSoft } = assignColor(totalPersons)
    const tags = form.tags
      .split(",")
      .map(t => t.trim())
      .filter(Boolean)
    const res = await fetch("/api/persons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        emails: emails.map(e => e.trim()).filter(Boolean),
        phones: phones.map(p => p.trim()).filter(Boolean),
        tags,
        values: [],
        color,
        colorSoft,
      }),
    })
    setLoading(false)
    if (!res.ok) {
      setError("Failed to save. Please try again.")
      return
    }
    onSaved()
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
          <h2 style={{ fontFamily: "var(--font-playfair), serif", fontSize: "20px", fontWeight: 600, margin: 0, color: "var(--ink)" }}>
            Add Person
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: "18px", padding: "4px" }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="First name *" value={form.first} onChange={v => set("first", v)} placeholder="Marcus" />
            <Field label="Last name *" value={form.last} onChange={v => set("last", v)} placeholder="Chen" />
          </div>
          <Field label="Title" value={form.title} onChange={v => set("title", v)} placeholder="Product Lead" />
          <Field label="Headline" value={form.headline} onChange={v => set("headline", v)} placeholder="Design systems, angel investing, old friend from YC" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="Company" value={form.company} onChange={v => set("company", v)} placeholder="Notion" />
            <Field label="Location" value={form.location} onChange={v => set("location", v)} placeholder="San Francisco" />
          </div>

          <MultiField
            label="Email"
            values={emails}
            onChange={setEmails}
            placeholder="marcus@example.com"
            type="email"
          />
          <MultiField
            label="Phone"
            values={phones}
            onChange={setPhones}
            placeholder="+1 (555) 000-0000"
            type="tel"
          />

          <Field label="Birthday" value={form.birthday} onChange={v => set("birthday", v)} placeholder="YYYY-MM-DD" />

          <div>
            <label style={labelStyle}>Closeness</label>
            <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
              {[
                [1, "Acquaintance"],
                [2, "Nurture"],
                [3, "Friend"],
                [4, "Inner Circle"],
              ].map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => set("closeness", val as number)}
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

          <Field label="Tags (comma separated)" value={form.tags} onChange={v => set("tags", v)} placeholder="investor, bay area, founder" />
          <Field label="Notes" value={form.notes} onChange={v => set("notes", v)} placeholder="Met at YC batch dinner…" multiline />

          {error && <p style={{ color: "var(--accent)", fontSize: "12px", margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={loading} style={submitBtnStyle}>{loading ? "Saving…" : "Add Person"}</button>
          </div>
        </form>
      </div>
    </div>
  )
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
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
        />
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
