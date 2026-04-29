"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import type { ParsedContact } from "@/lib/vcard"
import type { Person } from "@/types"
import { assignColor } from "@/lib/colors"

const PAGE_SIZE = 25
const DUPLICATE_THRESHOLD = 0.85
const POSSIBLE_THRESHOLD  = 0.70

// ── Jaro-Winkler (inline for client-side matching) ────────────────────────────

function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const l1 = s1.length, l2 = s2.length
  if (!l1 || !l2) return 0
  const md = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0)
  const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false)
  let m = 0
  for (let i = 0; i < l1; i++) {
    for (let j = Math.max(0, i - md); j < Math.min(i + md + 1, l2); j++) {
      if (m2[j] || s1[i] !== s2[j]) continue
      m1[i] = m2[j] = true; m++; break
    }
  }
  if (!m) return 0
  let t = 0, k = 0
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue
    while (!m2[k]) k++
    if (s1[i] !== s2[k]) t++
    k++
  }
  return (m / l1 + m / l2 + (m - t / 2) / m) / 3
}

function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b)
  let p = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) p++; else break
  }
  return j + p * 0.1 * (1 - j)
}

function norm(s: string) { return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "") }

// ── Types ─────────────────────────────────────────────────────────────────────

type MatchResult = {
  personId:      string
  personName:    string
  personEmail:   string | null  // first email for display
  personCompany: string | null
  score:         number
  reason:        string
  fillableFields: Record<string, string>
  fillableCount:  number
}

type ContactAction = "import" | "update_existing" | "import_new" | "skip"

type ReviewContact = ParsedContact & {
  closeness:   number
  tags:        string
  skip:        boolean
  colorIdx:    number
  guessedName: boolean
  guessedFrom: string | null
  needsReview: boolean
  matchResult: MatchResult | null
  action:      ContactAction
  selected:    boolean
}

type ContactStatus = "ready" | "review" | "error" | "duplicate" | "possible"
type FilterKey     = "all" | "new" | ContactStatus

type Step = "upload" | "review" | "done"

// ── Status helpers ─────────────────────────────────────────────────────────────

function getStatus(c: ReviewContact): ContactStatus {
  if (c.matchResult) {
    return c.matchResult.score >= DUPLICATE_THRESHOLD ? "duplicate" : "possible"
  }
  if (!c.first?.trim() && !c.email) return "error"
  if (c.guessedName || !c.email) return "review"
  return "ready"
}

const STATUS_COLOR: Record<ContactStatus | "skipped", string> = {
  duplicate: "#7c3aed",
  possible:  "#ea580c",
  ready:     "#16a34a",
  review:    "#d97706",
  error:     "#dc2626",
  skipped:   "#d1d5db",
}

const STATUS_LABEL: Record<FilterKey, string> = {
  all:       "All",
  new:       "New",
  duplicate: "Duplicates",
  possible:  "Possible",
  ready:     "Ready",
  review:    "Needs Review",
  error:     "Errors",
}

function sortByStatus(contacts: ReviewContact[]): ReviewContact[] {
  const order = (c: ReviewContact) => {
    if (c.skip) return 5
    const s = getStatus(c)
    if (s === "duplicate") return 0
    if (s === "possible")  return 1
    if (s === "error")     return 2
    if (s === "review")    return 3
    return 4
  }
  return [...contacts].sort((a, b) => order(a) - order(b))
}

// ── Matching ──────────────────────────────────────────────────────────────────

function computeFillableFields(contact: ParsedContact, person: Person): Record<string, string> {
  const result: Record<string, string> = {}
  // email: fillable if contact has an email not already in person's list
  if (contact.email?.trim() && !person.emails.some(e => e.toLowerCase() === contact.email!.toLowerCase().trim())) {
    result.email = contact.email.trim()
  }
  // phone: fillable if contact has a phone not already in person's list
  if (contact.phone?.trim()) {
    const cp = contact.phone.trim().replace(/\D/g, "")
    if (cp.length >= 7 && !person.phones.some(p => p.replace(/\D/g, "") === cp)) {
      result.phone = contact.phone.trim()
    }
  }
  const pairs: [keyof ParsedContact, keyof Person][] = [
    ["company", "company"], ["headline", "headline"], ["birthday", "birthday"],
    ["location", "location"], ["linkedin", "linkedin"], ["twitter", "twitter"],
    ["website", "website"], ["notes", "notes"],
  ]
  for (const [ck, pk] of pairs) {
    const cv = (contact[ck] as string | null)?.trim()
    const pv = (person[pk] as string | null)?.trim()
    if (cv && !pv) result[pk as string] = cv
  }
  return result
}

function findMatch(contact: ParsedContact, persons: Person[]): MatchResult | null {
  let best: { score: number; reason: string; person: Person } | null = null

  for (const p of persons) {
    // Any matching email
    if (contact.email?.trim() && p.emails.length) {
      const ce = contact.email.toLowerCase().trim()
      if (p.emails.some(e => e.toLowerCase().trim() === ce)) {
        if (!best || 1.0 > best.score) { best = { score: 1.0, reason: "Same email address", person: p }; continue }
      }
    }
    // Any matching phone
    const cp = (contact.phone ?? "").replace(/\D/g, "")
    if (cp.length >= 7 && p.phones.some(ph => ph.replace(/\D/g, "") === cp)) {
      if (!best || 0.97 > best.score) { best = { score: 0.97, reason: "Same phone number", person: p }; continue }
    }
    // Name similarity
    const cn = norm(`${contact.first ?? ""} ${contact.last ?? ""}`)
    const pn = norm(`${p.first} ${p.last}`)
    if (!cn || !pn) continue
    const nameSim = jaroWinkler(cn, pn)
    const sameCompany = !!(contact.company && p.company &&
      jaroWinkler(norm(contact.company), norm(p.company)) > 0.85)

    let score = 0, reason = ""
    if (nameSim >= 0.92) {
      score  = Math.min(1, nameSim + (sameCompany ? 0.03 : 0))
      reason = sameCompany ? "Similar name, same company" : "Very similar name"
    } else if (nameSim >= 0.80 && sameCompany) {
      score  = nameSim
      reason = "Similar name, same company"
    } else if (nameSim >= POSSIBLE_THRESHOLD) {
      score  = nameSim
      reason = "Similar name"
    }

    if (score >= POSSIBLE_THRESHOLD && (!best || score > best.score)) {
      best = { score, reason, person: p }
    }
  }

  if (!best) return null
  const fillableFields = computeFillableFields(contact, best.person)
  return {
    personId:      best.person.id,
    personName:    `${best.person.first} ${best.person.last}`.trim(),
    personEmail:   best.person.emails[0] ?? null,
    personCompany: best.person.company,
    score:         best.score,
    reason:        best.reason,
    fillableFields,
    fillableCount: Object.keys(fillableFields).length,
  }
}

// ── Name guessing ─────────────────────────────────────────────────────────────

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() }

function guessNameFromEmail(email: string): { first: string; last: string } | null {
  const local = email.split("@")[0]
  if (!local) return null
  const cleaned = local.replace(/\d+$/, "").replace(/^[._-]+|[._-]+$/g, "")
  if (!cleaned || cleaned.length < 2) return null
  for (const sep of [".", "_", "-"]) {
    const parts = cleaned.split(sep).filter(p => p.length >= 2)
    if (parts.length >= 2) return { first: capitalize(parts[0]), last: capitalize(parts[parts.length - 1]) }
  }
  return { first: capitalize(cleaned), last: "" }
}

// ── Field filter chips ────────────────────────────────────────────────────────

type FieldKey = "first" | "last" | "email" | "phone" | "company" | "headline" | "birthday" | "location" | "linkedin" | "twitter" | "website" | "notes" | "guessed"

type FieldChip = { key: FieldKey; label: string; check: (c: ReviewContact) => boolean }

const FIELD_CHIPS: FieldChip[] = [
  { key: "first",    label: "First name", check: c => !!(c.first?.trim()) },
  { key: "last",     label: "Last name",  check: c => !!(c.last?.trim()) },
  { key: "email",    label: "Email",      check: c => !!(c.email?.trim()) },
  { key: "phone",    label: "Phone",      check: c => !!(c.phone?.trim()) },
  { key: "company",  label: "Company",    check: c => !!(c.company?.trim()) },
  { key: "headline", label: "Title",      check: c => !!(c.headline?.trim()) },
  { key: "birthday", label: "Birthday",   check: c => !!(c.birthday?.trim() && !c.birthday.startsWith("0000")) },
  { key: "location", label: "Location",   check: c => !!(c.location?.trim()) },
  { key: "linkedin", label: "LinkedIn",   check: c => !!(c.linkedin?.trim()) },
  { key: "twitter",  label: "Twitter",    check: c => !!(c.twitter?.trim()) },
  { key: "website",  label: "Website",    check: c => !!(c.website?.trim()) },
  { key: "notes",    label: "Notes",      check: c => !!(c.notes?.trim()) },
  { key: "guessed",  label: "Guessed name", check: c => c.guessedName },
]

// ── Quality stats ─────────────────────────────────────────────────────────────

type QualityStats = {
  total: number; needsReview: number; guessedName: number
  noEmail: number; noPhone: number; noCompany: number
  duplicates: number; possibles: number
}

function computeStats(contacts: ReviewContact[]): QualityStats {
  return {
    total:       contacts.length,
    needsReview: contacts.filter(c => c.needsReview).length,
    guessedName: contacts.filter(c => c.guessedName).length,
    noEmail:     contacts.filter(c => !c.email).length,
    noPhone:     contacts.filter(c => !c.phone).length,
    noCompany:   contacts.filter(c => !c.company).length,
    duplicates:  contacts.filter(c => !c.skip && c.matchResult !== null && c.matchResult.score >= DUPLICATE_THRESHOLD).length,
    possibles:   contacts.filter(c => !c.skip && c.matchResult !== null && c.matchResult.score < DUPLICATE_THRESHOLD).length,
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ImportContactsPage() {
  const router  = useRouter()
  const [step, setStep]                     = useState<Step>("upload")
  const [contacts, setContacts]             = useState<ReviewContact[]>([])
  const [existingPersons, setExistingPersons] = useState<Person[]>([])
  const [dragging, setDragging]             = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [loading, setLoading]               = useState(false)
  const [loadingMsg, setLoadingMsg]         = useState("Parsing contacts…")
  const [saving, setSaving]                 = useState(false)
  const [savedCount, setSavedCount]         = useState(0)
  const [updatedCount, setUpdatedCount]     = useState(0)
  const [filter, setFilter]                 = useState<FilterKey>("all")
  const [page, setPage]                     = useState(0)
  const [autoSkipped, setAutoSkipped]       = useState(0)
  const [requiredFields, setRequiredFields] = useState<Set<FieldKey>>(new Set())
  const inputRef  = useRef<HTMLInputElement>(null)
  const cardRefs  = useRef<(HTMLDivElement | null)[]>([])

  // Load existing persons for matching (lightweight — only needs id/name/email/phone/company)
  useEffect(() => {
    fetch("/api/persons?minimal=true")
      .then(r => r.json())
      .then((data: Person[]) => setExistingPersons(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // ── Parse + Match ──────────────────────────────────────────────────────────

  async function processFile(file: File) {
    setError(null)
    setLoading(true)
    const isCsv = file.name.endsWith(".csv")
    setLoadingMsg(isCsv ? "Mapping columns with AI…" : "Parsing contacts…")

    try {
      const content = await file.text()
      const res = await fetch("/api/import/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, format: isCsv ? "csv" : "vcf" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to parse file")

      setLoadingMsg("Matching against existing contacts…")

      let skippedCount = 0
      const review: ReviewContact[] = data.contacts.map((c: ParsedContact, i: number) => {
        const hasRealName  = !!(c.first?.trim())
        const totallyEmpty = !c.first?.trim() && !c.email && !c.phone
        let guessedName = false, guessedFrom: string | null = null
        let first = c.first ?? "", last = c.last ?? ""

        if (!hasRealName && c.email) {
          const guess = guessNameFromEmail(c.email)
          if (guess) { first = guess.first; last = guess.last; guessedName = true; guessedFrom = c.email }
        }

        if (totallyEmpty) skippedCount++

        const matchResult = totallyEmpty ? null : findMatch({ ...c, first, last }, existingPersons)
        const action: ContactAction = matchResult
          ? (matchResult.score >= DUPLICATE_THRESHOLD ? "update_existing" : "import_new")
          : "import"

        return {
          ...c, first, last,
          closeness: 1, tags: "", colorIdx: i,
          skip: totallyEmpty,
          guessedName, guessedFrom,
          needsReview: !hasRealName,
          matchResult, action,
          selected: false,
        }
      })

      setAutoSkipped(skippedCount)
      setContacts(sortByStatus(review))
      setFilter("all")
      setPage(0)
      setStep("review")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file")
    } finally {
      setLoading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const file = Array.from(e.dataTransfer.files).find(f => f.name.endsWith(".vcf") || f.name.endsWith(".csv"))
    if (file) processFile(file)
    else setError("Please drop a .vcf or .csv file.")
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ""
  }

  // ── Update ────────────────────────────────────────────────────────────────

  const update = useCallback((idx: number, patch: Partial<ReviewContact>) => {
    setContacts(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }, [])

  // ── Import ────────────────────────────────────────────────────────────────

  function passesFieldFilter(c: ReviewContact): boolean {
    for (const key of requiredFields) {
      const chip = FIELD_CHIPS.find(fc => fc.key === key)
      if (chip && !chip.check(c)) return false
    }
    return true
  }

  async function handleConfirm() {
    setSaving(true); setError(null)
    const toProcess = contacts.filter(c => !c.skip && c.action !== "skip" && passesFieldFilter(c))

    try {
      // Fetch current count for color assignment only
      const countRes = await fetch("/api/persons?minimal=true")
      const existing = countRes.ok ? await countRes.json() : []
      const offset   = existing.length
      let created = 0, updated = 0

      for (const c of toProcess) {
        if (c.action === "update_existing" && c.matchResult) {
          const fields = c.matchResult.fillableFields
          if (Object.keys(fields).length > 0) {
            await fetch(`/api/persons/${c.matchResult.personId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(fields),
            })
          }
          updated++
        } else {
          const { color, colorSoft } = assignColor(offset + created)
          const tags = c.tags.split(",").map(t => t.trim()).filter(Boolean)
          const res  = await fetch("/api/persons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              first: c.first, last: c.last, headline: c.headline, company: c.company,
              email: c.email, phone: c.phone,
              birthday: c.birthday && !c.birthday.startsWith("0000") ? c.birthday : null,
              closeness: c.closeness, tags, values: [], notes: c.notes, location: c.location,
              linkedin: c.linkedin, twitter: c.twitter, website: c.website, color, colorSoft,
            }),
          })
          if (res.ok) created++
        }
      }

      setSavedCount(created)
      setUpdatedCount(updated)
      setStep("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setSaving(false)
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const totalActiveCount    = contacts.filter(c => !c.skip && c.action !== "skip").length
  const activeCount         = contacts.filter(c => !c.skip && c.action !== "skip" && passesFieldFilter(c)).length
  const hiddenByFieldFilter = totalActiveCount - activeCount
  const stats       = step === "review" ? computeStats(contacts) : null

  const statusCounts: Record<FilterKey, number> = {
    all:       contacts.length,
    new:       contacts.filter(c => !c.skip && !c.matchResult).length,
    duplicate: contacts.filter(c => !c.skip && (c.matchResult?.score ?? 0) >= DUPLICATE_THRESHOLD).length,
    possible:  contacts.filter(c => !c.skip && c.matchResult !== null && (c.matchResult?.score ?? 0) < DUPLICATE_THRESHOLD).length,
    ready:     contacts.filter(c => !c.skip && !c.matchResult && getStatus(c) === "ready").length,
    review:    contacts.filter(c => !c.skip && !c.matchResult && getStatus(c) === "review").length,
    error:     contacts.filter(c => !c.skip && getStatus(c) === "error").length,
  }

  const filteredPairs = contacts
    .map((contact, globalIndex) => ({ contact, globalIndex }))
    .filter(({ contact }) => {
      // Status filter
      if (filter !== "all") {
        if (contact.skip) return false
        if (filter === "new" && contact.matchResult) return false
        if (filter !== "new" && getStatus(contact) !== filter) return false
      }
      // Field filter — must have ALL required fields
      for (const key of requiredFields) {
        const chip = FIELD_CHIPS.find(fc => fc.key === key)
        if (chip && !chip.check(contact)) return false
      }
      return true
    })

  const totalPages    = Math.ceil(filteredPairs.length / PAGE_SIZE)
  const pagePairs     = filteredPairs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const selectedPairs = contacts
    .map((contact, globalIndex) => ({ contact, globalIndex }))
    .filter(p => p.contact.selected && !p.contact.skip)

  const allFilterSelected = filteredPairs.length > 0 && filteredPairs.every(p => p.contact.selected)

  function jumpToCard(localIdx: number) {
    cardRefs.current[localIdx]?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  function changeFilter(f: FilterKey) { setFilter(f); setPage(0) }

  function toggleField(key: FieldKey) {
    setRequiredFields(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
    setPage(0)
  }

  function clearFieldFilters() { setRequiredFields(new Set()); setPage(0) }

  function toggleSelectAll() {
    const target = !allFilterSelected
    filteredPairs.forEach(({ globalIndex }) => update(globalIndex, { selected: target }))
  }

  function clearSelection() {
    setContacts(prev => prev.map(c => ({ ...c, selected: false })))
  }

  function skipAllInFilter() {
    filteredPairs.filter(p => !p.contact.skip).forEach(({ globalIndex }) =>
      update(globalIndex, { skip: true })
    )
  }

  function bulkSetAction(action: ContactAction) {
    selectedPairs.forEach(({ globalIndex }) => update(globalIndex, { action, selected: false }))
  }

  function bulkSkip() {
    selectedPairs.forEach(({ globalIndex }) => update(globalIndex, { skip: true, selected: false }))
  }

  // Keep only selected contacts — skip everything else that isn't already skipped
  function bulkKeepOnly() {
    const selectedIds = new Set(selectedPairs.map(p => p.globalIndex))
    setContacts(prev => prev.map((c, i) => {
      if (c.skip) return c
      if (selectedIds.has(i)) return { ...c, selected: false }
      return { ...c, skip: true }
    }))
  }

  // Skip all contacts that don't pass the current field filter
  function skipNonMatching() {
    setContacts(prev => prev.map(c => {
      if (c.skip) return c
      for (const key of requiredFields) {
        const chip = FIELD_CHIPS.find(fc => fc.key === key)
        if (chip && !chip.check(c)) return { ...c, skip: true }
      }
      return c
    }))
  }

  const filterKeys: FilterKey[] = ["all", "duplicate", "possible", "new", "review", "error"]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 24px 80px" }}>
      <a href="/import" style={{ fontSize: "11px", color: "var(--ink-4)", textDecoration: "none", display: "inline-block", marginBottom: "20px" }}>
        ← Import
      </a>

      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontFamily: "var(--font-playfair), serif", fontSize: "26px", fontWeight: 600, color: "var(--ink)", margin: "0 0 6px" }}>
          Import from Contacts
        </h1>
        <p style={{ color: "var(--ink-3)", fontSize: "12px", margin: 0 }}>
          Export a vCard (.vcf) from Contacts.app, then drop it here.
        </p>
      </div>

      {/* ── Upload ── */}
      {step === "upload" && (
        <>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px 18px", marginBottom: "20px", fontSize: "12px", color: "var(--ink-2)", lineHeight: 1.7 }}>
            <div style={{ fontFamily: "var(--font-playfair), serif", fontSize: "14px", fontWeight: 500, color: "var(--ink)", marginBottom: "6px" }}>How to export from Contacts.app</div>
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
            style={{ border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`, borderRadius: "12px", padding: "48px 24px", textAlign: "center", cursor: loading ? "wait" : "pointer", background: dragging ? "var(--accent-soft)" : "var(--surface)", transition: "all 0.15s" }}
          >
            <input ref={inputRef} type="file" accept=".vcf,.csv" onChange={handleFileInput} style={{ display: "none" }} />
            {loading ? (
              <>
                <div style={{ width: "32px", height: "32px", border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                <div style={{ color: "var(--ink-3)", fontSize: "12px" }}>{loadingMsg}</div>
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

      {/* ── Review ── */}
      {step === "review" && stats && (
        <>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <div>
              <h2 style={{ fontFamily: "var(--font-playfair), serif", fontSize: "18px", fontWeight: 600, margin: "0 0 2px", color: "var(--ink)" }}>
                {contacts.length} contact{contacts.length !== 1 ? "s" : ""} found
              </h2>
              <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>
                {stats.duplicates > 0 && <span style={{ color: STATUS_COLOR.duplicate }}>{stats.duplicates} duplicate{stats.duplicates !== 1 ? "s" : ""} · </span>}
                {stats.possibles > 0 && <span style={{ color: STATUS_COLOR.possible }}>{stats.possibles} possible · </span>}
                {existingPersons.length > 0 && <span>matched against {existingPersons.length} existing · </span>}
                use rail to jump
              </div>
            </div>
            <button onClick={() => setStep("upload")} style={ghostBtnStyle}>← Back</button>
          </div>

          {/* Auto-skip notice */}
          {autoSkipped > 0 && (
            <div style={{ marginBottom: "12px", padding: "8px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "7px", fontSize: "11px", color: "var(--ink-3)" }}>
              {autoSkipped} empty row{autoSkipped !== 1 ? "s" : ""} auto-skipped
            </div>
          )}

          {/* Quality banner */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "12px 14px", marginBottom: "14px" }}>
            <div style={{ fontSize: "10px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "8px" }}>Data quality</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <StatChip value={stats.total - stats.needsReview} label="have a name"    of={stats.total} good />
              <StatChip value={stats.total - stats.noEmail}    label="have email"      of={stats.total} good />
              <StatChip value={stats.total - stats.noPhone}    label="have phone"      of={stats.total} good />
              {stats.noCompany > 0 && <StatChip value={stats.total - stats.noCompany} label="have company" of={stats.total} good />}
              {stats.duplicates > 0 && <StatChip value={stats.duplicates} label="duplicates"   of={stats.total} warn />}
              {stats.possibles  > 0 && <StatChip value={stats.possibles}  label="possible dups" of={stats.total} warn />}
            </div>
          </div>

          {/* Field filter chips */}
          {(() => {
            const nonSkipped = contacts.filter(c => !c.skip)
            return (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "10px 14px", marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "7px" }}>
                  <div style={{ fontSize: "10px", color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    Show only contacts with…
                  </div>
                  {requiredFields.size > 0 && (
                    <button onClick={clearFieldFilters} style={{ background: "none", border: "none", color: "var(--ink-4)", cursor: "pointer", fontSize: "10px", padding: 0 }}>
                      Clear filters ✕
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                  {FIELD_CHIPS.map(({ key, label, check }) => {
                    const active = requiredFields.has(key)
                    const count  = nonSkipped.filter(check).length
                    const pct    = nonSkipped.length ? Math.round((count / nonSkipped.length) * 100) : 0
                    return (
                      <button
                        key={key}
                        onClick={() => toggleField(key)}
                        style={{
                          padding: "4px 10px", borderRadius: "20px", fontFamily: "inherit", fontSize: "10px", cursor: "pointer",
                          border:     `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                          background: active ? "var(--accent-soft)" : "var(--surface2)",
                          color:      active ? "var(--accent)" : "var(--ink-3)",
                          fontWeight: active ? 600 : 400,
                          display: "flex", alignItems: "center", gap: "5px",
                        }}
                      >
                        {active && <span style={{ fontSize: "8px" }}>✓</span>}
                        {label}
                        <span style={{ fontSize: "9px", opacity: 0.6 }}>{pct}%</span>
                      </button>
                    )
                  })}
                </div>
                {requiredFields.size > 0 && (
                  <div style={{ marginTop: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <div style={{ fontSize: "10px", color: "var(--ink-3)" }}>
                      <span style={{ color: "var(--ink)", fontWeight: 500 }}>{filteredPairs.length}</span> of {contacts.filter(c => !c.skip).length} active contacts match
                      {" · "}
                      <span style={{ color: "var(--ink-4)" }}>
                        {Array.from(requiredFields).map(k => FIELD_CHIPS.find(c => c.key === k)?.label).join(" + ")}
                      </span>
                    </div>
                    {(() => {
                      const nonMatchCount = contacts.filter(c => {
                        if (c.skip) return false
                        for (const key of requiredFields) {
                          const chip = FIELD_CHIPS.find(fc => fc.key === key)
                          if (chip && !chip.check(c)) return true
                        }
                        return false
                      }).length
                      return nonMatchCount > 0 ? (
                        <button
                          onClick={skipNonMatching}
                          style={{ ...ghostBtnStyle, padding: "3px 10px", fontSize: "10px", color: "#dc2626", borderColor: "#fca5a5", whiteSpace: "nowrap" as const }}
                        >
                          Skip {nonMatchCount} non-matching
                        </button>
                      ) : null
                    })()}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Filter tabs + select-all */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "8px", flexWrap: "wrap" }}>
            {filterKeys.map(f => {
              const active   = filter === f
              const dotColor = f === "all" || f === "new" ? "var(--ink-4)" : STATUS_COLOR[f as ContactStatus]
              return (
                <button key={f} onClick={() => changeFilter(f)} style={{
                  padding: "5px 12px", borderRadius: "6px", fontFamily: "inherit", fontSize: "11px", cursor: "pointer",
                  border:     `1px solid ${active ? dotColor : "var(--border)"}`,
                  background: active ? `${dotColor}18` : "transparent",
                  color:      active ? dotColor : "var(--ink-3)",
                  fontWeight: active ? 500 : 400,
                  display: "flex", alignItems: "center", gap: "5px",
                }}>
                  {f !== "all" && f !== "new" && (
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 }} />
                  )}
                  {STATUS_LABEL[f]}
                  <span style={{ fontSize: "10px", opacity: 0.65 }}>({statusCounts[f]})</span>
                </button>
              )
            })}
          </div>

          {/* Select all row */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", minHeight: "24px" }}>
            {filteredPairs.length > 0 && (
              <button onClick={toggleSelectAll} style={{ ...ghostBtnStyle, padding: "3px 10px", fontSize: "10px" }}>
                {allFilterSelected ? "Deselect all" : `Select all ${filteredPairs.length}`}
              </button>
            )}
            {selectedPairs.length > 0 && (
              <>
                <span style={{ fontSize: "10px", color: "var(--ink-3)", fontWeight: 500 }}>
                  {selectedPairs.length} selected ·
                </span>
                <button onClick={bulkSkip} style={{ ...ghostBtnStyle, padding: "3px 10px", fontSize: "10px" }}>Skip</button>
                {selectedPairs.some(p => p.contact.matchResult) && (
                  <>
                    <button onClick={() => bulkSetAction("update_existing")} style={{ ...ghostBtnStyle, padding: "3px 10px", fontSize: "10px", color: STATUS_COLOR.duplicate, borderColor: STATUS_COLOR.duplicate }}>
                      Update existing
                    </button>
                    <button onClick={() => bulkSetAction("import_new")} style={{ ...ghostBtnStyle, padding: "3px 10px", fontSize: "10px" }}>
                      Import as new
                    </button>
                  </>
                )}
                {selectedPairs.every(p => !p.contact.matchResult) && (
                  <button onClick={bulkKeepOnly} style={{ ...ghostBtnStyle, padding: "3px 10px", fontSize: "10px", color: STATUS_COLOR.ready, borderColor: STATUS_COLOR.ready }}>
                    Keep only selected
                  </button>
                )}
                <button onClick={clearSelection} style={{ background: "none", border: "none", color: "var(--ink-4)", cursor: "pointer", fontSize: "10px", padding: "3px 4px" }}>✕</button>
              </>
            )}
          </div>

          {/* List + Rail */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 14px", gap: "8px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {pagePairs.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px", color: "var(--ink-4)", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "8px" }}>
                  No contacts in this filter.
                </div>
              ) : pagePairs.map(({ contact, globalIndex }, localIdx) => (
                <div key={globalIndex} ref={el => { cardRefs.current[localIdx] = el }}>
                  <ContactReviewCard
                    contact={contact}
                    onChange={patch => update(globalIndex, patch)}
                  />
                </div>
              ))}
            </div>
            <StatusRail items={pagePairs.map(p => p.contact)} onJump={jumpToCard} />
          </div>

          {/* Pagination */}
          {filteredPairs.length > PAGE_SIZE && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", marginTop: "10px", fontSize: "11px", color: "var(--ink-3)" }}>
              <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredPairs.length)} of {filteredPairs.length}</span>
              <div style={{ display: "flex", gap: "6px" }}>
                {page > 0 && <button onClick={() => setPage(p => p - 1)} style={ghostBtnStyle}>← Prev</button>}
                {(page + 1) < totalPages && <button onClick={() => setPage(p => p + 1)} style={ghostBtnStyle}>Next →</button>}
              </div>
            </div>
          )}

          {error && <p style={{ color: "var(--accent)", fontSize: "12px", marginTop: "10px" }}>{error}</p>}
        </>
      )}

      {/* ── Done ── */}
      {step === "done" && (
        <div style={{ textAlign: "center", padding: "56px 32px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }}>
          <div style={{ fontSize: "30px", marginBottom: "14px" }}>✓</div>
          <h2 style={{ fontFamily: "var(--font-playfair), serif", fontSize: "22px", fontWeight: 600, color: "var(--ink)", margin: "0 0 8px" }}>
            {savedCount + updatedCount > 0
              ? `${savedCount > 0 ? `${savedCount} added` : ""}${savedCount > 0 && updatedCount > 0 ? " · " : ""}${updatedCount > 0 ? `${updatedCount} updated` : ""}`
              : "Nothing to import"}
          </h2>
          <p style={{ color: "var(--ink-3)", fontSize: "12px", marginBottom: "24px" }}>
            {savedCount > 0 && updatedCount > 0
              ? `${savedCount} new contact${savedCount !== 1 ? "s" : ""} added and ${updatedCount} existing updated.`
              : savedCount > 0
              ? `${savedCount} new contact${savedCount !== 1 ? "s" : ""} added.`
              : `${updatedCount} existing contact${updatedCount !== 1 ? "s" : ""} updated with new info.`}
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            <button onClick={() => router.push("/contacts")} style={{ padding: "10px 24px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "7px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 500 }}>
              View Contacts →
            </button>
            <button onClick={() => { setStep("upload"); setContacts([]) }} style={{ padding: "10px 24px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "7px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" }}>
              Import More
            </button>
          </div>
        </div>
      )}

      {/* ── Sticky bottom bar ── */}
      {step === "review" && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "var(--surface)", borderTop: "1px solid var(--border)",
          padding: "12px 24px", display: "flex", alignItems: "center",
          justifyContent: "space-between", zIndex: 40,
          boxShadow: "0 -4px 16px rgba(26,24,20,0.07)",
        }}>
          <div style={{ fontSize: "11px", color: "var(--ink-3)" }}>
            <span style={{ color: "var(--ink)", fontWeight: 500 }}>{activeCount}</span> will be imported
            {hiddenByFieldFilter > 0 && (
              <span style={{ marginLeft: "6px", color: "#d97706" }}>
                · {hiddenByFieldFilter} excluded by field filter
              </span>
            )}
            {hiddenByFieldFilter === 0 && (() => {
              const updateCount = contacts.filter(c => !c.skip && c.action === "update_existing" && passesFieldFilter(c)).length
              const newCount    = contacts.filter(c => !c.skip && c.action !== "update_existing" && c.action !== "skip" && passesFieldFilter(c)).length
              if (updateCount > 0 && newCount > 0) return (
                <span style={{ color: "var(--ink-4)", marginLeft: "6px" }}>
                  ({newCount} new · <span style={{ color: STATUS_COLOR.duplicate }}>{updateCount} updates</span>)
                </span>
              )
              if (updateCount > 0) return <span style={{ color: STATUS_COLOR.duplicate, marginLeft: "6px" }}>({updateCount} updates to existing)</span>
              return null
            })()}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            {filter !== "all" && filteredPairs.filter(p => !p.contact.skip).length > 0 && (
              <button onClick={skipAllInFilter} style={ghostBtnStyle}>
                Skip all {STATUS_LABEL[filter].toLowerCase()}
              </button>
            )}
            <button
              onClick={handleConfirm}
              disabled={saving || activeCount === 0}
              style={{ padding: "8px 20px", background: activeCount > 0 ? "var(--accent)" : "var(--border)", color: activeCount > 0 ? "#fff" : "var(--ink-4)", border: "none", borderRadius: "7px", cursor: activeCount > 0 && !saving ? "pointer" : "not-allowed", fontFamily: "inherit", fontSize: "12px", fontWeight: 500, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Importing…" : `Import ${activeCount}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Status rail ───────────────────────────────────────────────────────────────

function StatusRail({ items, onJump }: { items: ReviewContact[]; onJump: (idx: number) => void }) {
  return (
    <div style={{ position: "sticky", top: "72px", display: "flex", flexDirection: "column", gap: "3px", paddingTop: "2px" }}>
      {items.map((contact, i) => {
        const statusKey = contact.skip ? "skipped" : getStatus(contact)
        const color     = STATUS_COLOR[statusKey]
        return (
          <button
            key={i}
            onClick={() => onJump(i)}
            title={`${contact.first || "?"} ${contact.last} — ${statusKey}`}
            style={{ width: "8px", height: "22px", borderRadius: "4px", background: color, border: "none", cursor: "pointer", padding: 0, opacity: contact.skip ? 0.25 : 0.55, transition: "all 0.1s", flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.width = "12px" }}
            onMouseLeave={e => { e.currentTarget.style.opacity = contact.skip ? "0.25" : "0.55"; e.currentTarget.style.width = "8px" }}
          />
        )
      })}
    </div>
  )
}

// ── Stat chip ─────────────────────────────────────────────────────────────────

function StatChip({ value, label, of: total, good, warn }: { value: number; label: string; of: number; good?: boolean; warn?: boolean }) {
  const pct    = Math.round((value / total) * 100)
  const color  = warn ? "#b45309" : good && pct === 100 ? "#166534" : good ? "#1d4ed8" : "var(--ink-3)"
  const bg     = warn ? "#fef3c7" : good && pct === 100 ? "#dcfce7" : good ? "#eff6ff" : "var(--surface2)"
  const border = warn ? "#fde68a" : good && pct === 100 ? "#bbf7d0" : good ? "#bfdbfe" : "var(--border)"
  return (
    <div style={{ padding: "5px 10px", background: bg, border: `1px solid ${border}`, borderRadius: "7px", display: "flex", flexDirection: "column", gap: "1px", minWidth: "80px" }}>
      <div style={{ fontSize: "14px", fontWeight: 600, color, lineHeight: 1 }}>
        {value}<span style={{ fontSize: "9px", fontWeight: 400, opacity: 0.7, marginLeft: "2px" }}>/{total}</span>
      </div>
      <div style={{ fontSize: "10px", color }}>{label}</div>
    </div>
  )
}

// ── Contact review card ───────────────────────────────────────────────────────

function ContactReviewCard({
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
              <a href={`/contacts/${contact.matchResult!.personId}`} target="_blank" rel="noreferrer"
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
            <Field label="Last Name"><input type="text" value={contact.last} onChange={e => onChange({ last: e.target.value })} style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <Field label="Headline / Role"><input type="text" value={contact.headline ?? ""} onChange={e => onChange({ headline: e.target.value || null })} placeholder="e.g. Product Designer" style={inputStyle} /></Field>
            <Field label="Company"><input type="text" value={contact.company ?? ""} onChange={e => onChange({ company: e.target.value || null })} placeholder="e.g. Acme Corp" style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <Field label="Email"><input type="email" value={contact.email ?? ""} onChange={e => onChange({ email: e.target.value || null })} placeholder="email@example.com" style={inputStyle} /></Field>
            <Field label="Phone"><input type="tel" value={contact.phone ?? ""} onChange={e => onChange({ phone: e.target.value || null })} placeholder="+1 555 000 0000" style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <Field label="Birthday"><input type="text" value={contact.birthday && !contact.birthday.startsWith("0000") ? contact.birthday : ""} onChange={e => onChange({ birthday: e.target.value || null })} placeholder="YYYY-MM-DD" style={inputStyle} /></Field>
            <Field label="Location"><input type="text" value={contact.location ?? ""} onChange={e => onChange({ location: e.target.value || null })} placeholder="City, State" style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <Field label="LinkedIn"><input type="url" value={contact.linkedin ?? ""} onChange={e => onChange({ linkedin: e.target.value || null })} placeholder="linkedin.com/in/…" style={inputStyle} /></Field>
            <Field label="Twitter"><input type="text" value={contact.twitter ?? ""} onChange={e => onChange({ twitter: e.target.value || null })} placeholder="@handle" style={inputStyle} /></Field>
            <Field label="Website"><input type="url" value={contact.website ?? ""} onChange={e => onChange({ website: e.target.value || null })} placeholder="https://…" style={inputStyle} /></Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  color: "var(--ink-3)", fontSize: "10px", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase",
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: "6px", color: "var(--ink)", fontFamily: "inherit", fontSize: "12px",
  marginTop: "4px", boxSizing: "border-box",
}

const ghostBtnStyle: React.CSSProperties = {
  padding: "6px 13px", borderRadius: "6px", border: "1px solid var(--border)",
  background: "transparent", color: "var(--ink-3)", cursor: "pointer", fontFamily: "inherit", fontSize: "11px",
}
