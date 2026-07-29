"use client"

import { useState, type ReactNode, type CSSProperties } from "react"
import { assignColor } from "@/lib/colors"
import { getStatus, type ContactStatus, type ReviewContact } from "../matching"

const STATUS_COLOR: Record<ContactStatus | "skipped", string> = {
  duplicate: "#7c3aed", possible: "#ea580c", ready: "#16a34a", review: "#d97706", error: "#dc2626", skipped: "#d1d5db",
}

export function ContactReviewCard({
  contact,
  onChange,
}: {
  contact: ReviewContact
  onChange: (patch: Partial<ReviewContact>) => void
}) {
  const [open, setOpen]   = useState(false)
  const { color }         = assignColor(contact.colorIdx)
  const initials          = (contact.first[0] ?? "?") + (contact.last[0] ?? "")
  const statusKey         = contact.skip ? "skipped" : getStatus(contact)
  const statusColor       = STATUS_COLOR[statusKey]
  const isDuplicate       = statusKey === "duplicate"
  const isPossible        = statusKey === "possible"
  const isMatch           = isDuplicate || isPossible

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `3px solid ${statusColor}`, borderRadius: "8px", overflow: "hidden", opacity: contact.skip ? 0.4 : 1, transition: "opacity 0.15s" }}>
      {/* Card header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 13px" }}>

        {/* Checkbox */}
        {!contact.skip && (
          <input
            type="checkbox"
            checked={contact.selected}
            onChange={e => onChange({ selected: e.target.checked })}
            onClick={e => e.stopPropagation()}
            style={{ width: "14px", height: "14px", flexShrink: 0, cursor: "pointer", accentColor: statusColor }}
          />
        )}

        {/* Status dot */}
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />

        {/* Avatar */}
        <div
          style={{ width: 28, height: 28, borderRadius: "50%", background: `${color}22`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 500, flexShrink: 0, cursor: contact.skip ? "default" : "pointer" }}
          onClick={() => !contact.skip && setOpen(o => !o)}
        >
          {initials}
        </div>

        {/* Name + sub */}
        <div style={{ flex: 1, minWidth: 0, cursor: contact.skip ? "default" : "pointer" }} onClick={() => !contact.skip && setOpen(o => !o)}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 500, color: contact.guessedName ? "#92400e" : "var(--ink)" }}>
              {contact.first} {contact.last}
            </span>
            {contact.guessedName && !contact.skip && (
              <span style={{ fontSize: "9px", background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e", padding: "1px 5px", borderRadius: "20px", flexShrink: 0 }}>guessed</span>
            )}
          </div>
          <div style={{ fontSize: "11px", color: "var(--ink-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {contact.guessedName && contact.guessedFrom ? contact.guessedFrom : (contact.email ?? contact.headline ?? "")}
          </div>
        </div>

        {/* Right side controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          {!contact.skip && !isMatch && (
            <span style={{ fontSize: "10px", color: "var(--ink-4)", background: "var(--surface2)", padding: "2px 7px", borderRadius: "10px" }}>
              {["", "Acquaintance", "Friend", "Inner Circle"][contact.closeness]}
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onChange({ skip: !contact.skip }) }}
            style={{ fontSize: "10px", padding: "3px 8px", borderRadius: "5px", border: "1px solid var(--border)", background: "transparent", color: "var(--ink-4)", cursor: "pointer", fontFamily: "inherit" }}
          >
            {contact.skip ? "Undo" : "Skip"}
          </button>
          {!contact.skip && (
            <span style={{ color: "var(--ink-4)", fontSize: "10px", cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
              {open ? "▾" : "▸"}
            </span>
          )}
        </div>
      </div>

      {/* Match banner */}
      {isMatch && !contact.skip && (
        <div style={{
          margin: "0 13px 8px",
          padding: "8px 10px",
          background: isDuplicate ? "#f3f0ff" : "#fff7ed",
          border: `1px solid ${isDuplicate ? "#ddd6fe" : "#fed7aa"}`,
          borderRadius: "6px",
          fontSize: "11px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <span style={{ color: isDuplicate ? "#5b21b6" : "#9a3412", fontWeight: 500 }}>
                {isDuplicate ? "Duplicate" : "Possible match"}:
              </span>
              {" "}
              <a href={`/persons/${contact.matchResult!.personId}`} target="_blank" rel="noreferrer"
                style={{ color: isDuplicate ? "#7c3aed" : "#ea580c", textDecoration: "underline", cursor: "pointer" }}>
                {contact.matchResult!.personName}
              </a>
              {contact.matchResult!.personEmail && (
                <span style={{ color: "var(--ink-4)", marginLeft: "4px" }}>· {contact.matchResult!.personEmail}</span>
              )}
              <span style={{ color: "var(--ink-4)", marginLeft: "4px" }}>
                · {Math.round(contact.matchResult!.score * 100)}% ({contact.matchResult!.reason})
              </span>
            </div>
          </div>

          {/* Fillable fields preview */}
          {contact.matchResult!.fillableCount > 0 && contact.action === "update_existing" && (
            <div style={{ marginTop: "5px", color: "var(--ink-3)", fontSize: "10px" }}>
              Would add: {Object.keys(contact.matchResult!.fillableFields).join(", ")}
            </div>
          )}

          {/* Action selector */}
          <div style={{ display: "flex", gap: "5px", marginTop: "8px" }}>
            <ActionBtn
              label={`Update ${contact.matchResult!.personName.split(" ")[0]}`}
              sublabel={contact.matchResult!.fillableCount > 0 ? `+${contact.matchResult!.fillableCount} fields` : "nothing new"}
              active={contact.action === "update_existing"}
              color={isDuplicate ? "#7c3aed" : "#ea580c"}
              onClick={() => onChange({ action: "update_existing" })}
              disabled={contact.matchResult!.fillableCount === 0}
            />
            <ActionBtn
              label="Import as new"
              sublabel="create separate"
              active={contact.action === "import_new"}
              color="#6b7280"
              onClick={() => onChange({ action: "import_new" })}
            />
            <ActionBtn
              label="Skip"
              sublabel="don't import"
              active={contact.action === "skip"}
              color="#6b7280"
              onClick={() => onChange({ action: "skip" })}
            />
          </div>
        </div>
      )}

      {/* Expanded edit panel */}
      {open && !contact.skip && (
        <div style={{ padding: "0 13px 13px", borderTop: "1px solid var(--border)" }}>
          <div style={{ height: "10px" }} />

          {contact.guessedName && (
            <div style={{ marginBottom: "10px", padding: "7px 10px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: "6px", fontSize: "11px", color: "#92400e" }}>
              Name guessed from <strong>{contact.guessedFrom}</strong> — verify below.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <Field label="First Name"><input type="text" value={contact.first} onChange={e => onChange({ first: e.target.value })} style={inputStyle} /></Field>
            <Field label="Last Name (optional)"><input type="text" value={contact.last} onChange={e => onChange({ last: e.target.value })} style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <Field label="Title"><input type="text" value={contact.title ?? ""} onChange={e => onChange({ title: e.target.value || null })} placeholder="e.g. Product Designer" style={inputStyle} /></Field>
            <Field label="Headline"><input type="text" value={contact.headline ?? ""} onChange={e => onChange({ headline: e.target.value || null })} placeholder="e.g. Climate, board games, old teammate" style={inputStyle} /></Field>
            <Field label="Company"><input type="text" value={contact.company ?? ""} onChange={e => onChange({ company: e.target.value || null })} placeholder="e.g. Acme Corp" style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <Field label="Email"><input type="email" value={contact.email ?? ""} onChange={e => onChange({ email: e.target.value || null })} placeholder="email@example.com" style={inputStyle} /></Field>
            <Field label="Phone"><input type="tel" value={contact.phone ?? ""} onChange={e => onChange({ phone: e.target.value || null })} placeholder="+1 555 000 0000" style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <Field label="Birthday"><input type="text" value={contact.birthday ?? ""} onChange={e => onChange({ birthday: e.target.value || null })} placeholder="MM-DD or YYYY-MM-DD" style={inputStyle} /></Field>
            <Field label="Location"><input type="text" value={contact.location ?? ""} onChange={e => onChange({ location: e.target.value || null })} placeholder="City, State" style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <Field label="LinkedIn"><input type="url" value={contact.linkedin ?? ""} onChange={e => onChange({ linkedin: e.target.value || null })} placeholder="linkedin.com/in/…" style={inputStyle} /></Field>
            <Field label="Twitter"><input type="text" value={contact.twitter ?? ""} onChange={e => onChange({ twitter: e.target.value || null })} placeholder="@handle" style={inputStyle} /></Field>
            <Field label="Website"><input type="url" value={contact.website ?? ""} onChange={e => onChange({ website: e.target.value || null })} placeholder="https://…" style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <Field label="Facebook"><input type="url" value={contact.facebook ?? ""} onChange={e => onChange({ facebook: e.target.value || null })} placeholder="facebook.com/…" style={inputStyle} /></Field>
            <Field label="Instagram"><input type="text" value={contact.instagram ?? ""} onChange={e => onChange({ instagram: e.target.value || null })} placeholder="instagram.com/…" style={inputStyle} /></Field>
          </div>

          {!isMatch && (
            <div style={{ marginBottom: "10px" }}>
              <label style={labelStyle}>Closeness</label>
              <div style={{ display: "flex", gap: "5px", marginTop: "5px" }}>
                {([[1, "Acquaintance"], [2, "Friend"], [3, "Inner Circle"]] as [number, string][]).map(([val, lbl]) => (
                  <button key={val} type="button" onClick={() => onChange({ closeness: val })}
                    style={{ flex: 1, padding: "5px 4px", borderRadius: "5px", border: `1px solid ${contact.closeness === val ? "var(--accent)" : "var(--border)"}`, background: contact.closeness === val ? "var(--accent-soft)" : "var(--surface2)", color: contact.closeness === val ? "var(--accent)" : "var(--ink-3)", fontSize: "10px", cursor: "pointer", fontFamily: "inherit" }}
                  >{lbl}</button>
                ))}
              </div>
            </div>
          )}

          <Field label="Tags (comma separated)">
            <input type="text" value={contact.tags} onChange={e => onChange({ tags: e.target.value })} placeholder="designer, sf, college friend…" style={inputStyle} />
          </Field>
          <div style={{ height: "8px" }} />
          <Field label="Notes">
            <textarea value={contact.notes ?? ""} onChange={e => onChange({ notes: e.target.value || null })} rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
          </Field>
        </div>
      )}
    </div>
  )
}

// ── Action button (for match banner) ─────────────────────────────────────────

function ActionBtn({ label, sublabel, active, color, onClick, disabled }: {
  label: string; sublabel: string; active: boolean; color: string
  onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, padding: "5px 8px", borderRadius: "6px", fontFamily: "inherit",
        border: `1px solid ${active ? color : "var(--border)"}`,
        background: active ? `${color}18` : "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        textAlign: "left" as const,
      }}
    >
      <div style={{ fontSize: "10px", fontWeight: 500, color: active ? color : "var(--ink-3)" }}>{label}</div>
      <div style={{ fontSize: "9px", color: "var(--ink-4)" }}>{sublabel}</div>
    </button>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const labelStyle: CSSProperties = {
  color: "var(--ink-3)", fontSize: "10px", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase",
}

const inputStyle: CSSProperties = {
  width: "100%", padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: "6px", color: "var(--ink)", fontFamily: "inherit", fontSize: "12px",
  marginTop: "4px", boxSizing: "border-box",
}
