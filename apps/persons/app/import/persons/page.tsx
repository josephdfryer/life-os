"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import type { ParsedContact } from "@/lib/vcard"
import type { Person } from "@/types"
import { assignColor } from "@/lib/colors"
import { DUPLICATE_THRESHOLD, computeStats, findMatch, getStatus, guessNameFromEmail, sortByStatus, type ContactAction, type ContactStatus, type ReviewContact } from "./matching"
import { ContactReviewCard } from "./components/ContactReviewCard"
import { clearSelection as clearReviewSelection, keepOnly, setActionAt, setSelectedAt, skipAt, skipWhere } from "./review-transitions"
import type { SpreadsheetImportSummary } from "@/lib/spreadsheet-contacts"
import { requireSuccessfulImportResponse } from "./import-response"
import { loadAllExistingPersons } from "./load-existing-persons"

const PAGE_SIZE = 25
// ── Types ─────────────────────────────────────────────────────────────────────

type FilterKey     = "all" | "new" | ContactStatus

type Step = "upload" | "review" | "done"
type MatchingStatus = "loading" | "ready" | "error"

// ── Status helpers ─────────────────────────────────────────────────────────────

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

// ── Field filter chips ────────────────────────────────────────────────────────

type FieldKey = "first" | "last" | "email" | "phone" | "company" | "title" | "headline" | "birthday" | "location" | "linkedin" | "twitter" | "website" | "facebook" | "instagram" | "notes" | "guessed"

type FieldChip = { key: FieldKey; label: string; check: (c: ReviewContact) => boolean }

const FIELD_CHIPS: FieldChip[] = [
  { key: "first",    label: "First name", check: c => !!(c.first?.trim()) },
  { key: "last",     label: "Last name",  check: c => !!(c.last?.trim()) },
  { key: "email",    label: "Email",      check: c => !!(c.email?.trim()) },
  { key: "phone",    label: "Phone",      check: c => !!(c.phone?.trim()) },
  { key: "company",  label: "Company",    check: c => !!(c.company?.trim()) },
  { key: "title",    label: "Title",      check: c => !!(c.title?.trim()) },
  { key: "headline", label: "Headline",   check: c => !!(c.headline?.trim()) },
  { key: "birthday", label: "Birthday",   check: c => !!c.birthday?.trim() },
  { key: "location", label: "Location",   check: c => !!(c.location?.trim()) },
  { key: "linkedin",  label: "LinkedIn",   check: c => !!(c.linkedin?.trim()) },
  { key: "twitter",   label: "Twitter",    check: c => !!(c.twitter?.trim()) },
  { key: "website",   label: "Website",    check: c => !!(c.website?.trim()) },
  { key: "facebook",  label: "Facebook",   check: c => !!(c.facebook?.trim()) },
  { key: "instagram", label: "Instagram",  check: c => !!(c.instagram?.trim()) },
  { key: "notes",     label: "Notes",      check: c => !!(c.notes?.trim()) },
  { key: "guessed",  label: "Guessed name", check: c => c.guessedName },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ImportContactsPage() {
  const router  = useRouter()
  const [step, setStep]                     = useState<Step>("upload")
  const [contacts, setContacts]             = useState<ReviewContact[]>([])
  const [existingPersons, setExistingPersons] = useState<Person[]>([])
  const [matchingStatus, setMatchingStatus]   = useState<MatchingStatus>("loading")
  const [matchingError, setMatchingError]     = useState<string | null>(null)
  const [dragging, setDragging]             = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [loading, setLoading]               = useState(false)
  const [loadingMsg, setLoadingMsg]         = useState("Parsing people…")
  const [saving, setSaving]                 = useState(false)
  const [savedCount, setSavedCount]         = useState(0)
  const [updatedCount, setUpdatedCount]     = useState(0)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [filter, setFilter]                 = useState<FilterKey>("all")
  const [page, setPage]                     = useState(0)
  const [autoSkipped, setAutoSkipped]       = useState(0)
  const [gmailReconnectUrl, setGmailReconnectUrl] = useState<string | null>(null)
  const [requiredFields, setRequiredFields] = useState<Set<FieldKey>>(new Set())
  const [spreadsheetSummary, setSpreadsheetSummary] = useState<SpreadsheetImportSummary | null>(null)
  const [importMethod, setImportMethod]     = useState<string | null>(null)
  const [instagramRelationship, setInstagramRelationship] = useState<"follower" | "following">("follower")
  const inputRef  = useRef<HTMLInputElement>(null)
  const instagramInputRef = useRef<HTMLInputElement>(null)
  const cardRefs  = useRef<(HTMLDivElement | null)[]>([])

  const loadMatchingPeople = useCallback(async () => {
    setMatchingStatus("loading")
    setMatchingError(null)
    try {
      const people = await loadAllExistingPersons()
      setExistingPersons(people)
      setMatchingStatus("ready")
    } catch (loadError) {
      setExistingPersons([])
      setMatchingStatus("error")
      setMatchingError(loadError instanceof Error ? loadError.message : "Could not prepare duplicate checking.")
    }
  }, [])

  // Import cannot start until the complete existing-person set is ready.
  useEffect(() => {
    void loadMatchingPeople()
  }, [loadMatchingPeople])

  // ── Parse + Match ──────────────────────────────────────────────────────────

  async function processFile(file: File) {
    if (matchingStatus !== "ready") {
      setError(matchingStatus === "error"
        ? "Duplicate checking is unavailable. Retry it before importing."
        : "Still loading existing people for duplicate checking.")
      return
    }
    setError(null)
    setGmailReconnectUrl(null)
    setSpreadsheetSummary(null)
    setLoading(true)
    const lowerName = file.name.toLowerCase()
    const isCsv = lowerName.endsWith(".csv")
    const isSpreadsheet = lowerName.endsWith(".xlsx")
    setLoadingMsg(isCsv ? "Mapping columns with AI…" : isSpreadsheet ? "Finding people and related details…" : "Parsing people…")

    try {
      const res = isSpreadsheet
        ? await fetch("/api/import/contacts", {
            method: "POST",
            body: (() => {
              const form = new FormData()
              form.append("file", file)
              return form
            })(),
          })
        : await fetch("/api/import/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: await file.text(), format: isCsv ? "csv" : "vcf" }),
          })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to parse file")

      setSpreadsheetSummary(data.summary ?? null)
      setImportMethod(data.method === "claude" ? "csv" : data.method ?? null)
      processParsedContacts(data.contacts ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file")
    } finally {
      setLoading(false)
    }
  }

  async function importGmailContacts() {
    if (matchingStatus !== "ready") {
      setError(matchingStatus === "error"
        ? "Duplicate checking is unavailable. Retry it before importing."
        : "Still loading existing people for duplicate checking.")
      return
    }
    setError(null)
    setGmailReconnectUrl(null)
    setLoading(true)
    setLoadingMsg("Reading Google contacts…")
    try {
      const res = await fetch("/api/import/gmail-contacts")
      const data = await res.json()
      if (!res.ok) {
        const reconnectUrl = data.error?.details?.reconnectUrl
        if (data.error?.details?.reconnectRequired && reconnectUrl) {
          setGmailReconnectUrl(reconnectUrl)
          throw new Error("Reconnect Gmail to allow contacts import.")
        }
        throw new Error(data.error?.message || data.error || "Could not import Gmail contacts")
      }
      setImportMethod("gmail_contacts")
      processParsedContacts(data.contacts ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import Gmail contacts")
    } finally {
      setLoading(false)
    }
  }

  async function importInstagramFiles(files: FileList) {
    if (matchingStatus !== "ready") {
      setError(matchingStatus === "error"
        ? "Duplicate checking is unavailable. Retry it before importing."
        : "Still loading existing people for duplicate checking.")
      return
    }
    setError(null)
    setGmailReconnectUrl(null)
    setSpreadsheetSummary(null)
    setLoading(true)
    setLoadingMsg(`Reading Instagram ${instagramRelationship === "follower" ? "followers" : "following"}…`)
    try {
      const form = new FormData()
      form.append("relationship", instagramRelationship)
      Array.from(files).forEach(file => form.append("files", file))
      const res = await fetch("/api/import/instagram-contacts", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to read Instagram export")
      setImportMethod("instagram")
      processParsedContacts(data.contacts ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read Instagram export")
    } finally {
      setLoading(false)
    }
  }

  function handleInstagramInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files && files.length > 0) void importInstagramFiles(files)
    e.target.value = ""
  }

  function processParsedContacts(parsedContacts: ParsedContact[]) {
    if (!parsedContacts.length) {
      setError("No people could be found in that source.")
      return
    }
    setLoadingMsg("Matching against existing people…")

    let skippedCount = 0
    const review: ReviewContact[] = parsedContacts.map((c: ParsedContact, i: number) => {
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
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const file = Array.from(e.dataTransfer.files).find(f => /\.(vcf|csv|xlsx)$/i.test(f.name))
    if (file) processFile(file)
    else setError("Please drop a .vcf, .csv, or .xlsx file.")
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
    const toCreate  = toProcess.filter(c => c.action !== "update_existing" || !c.matchResult)
    const toUpdate  = toProcess.filter(c => c.action === "update_existing" && c.matchResult)
    setImportProgress({ done: 0, total: toProcess.length })

    try {
      const countRes = await fetch("/api/persons?minimal=true")
      const existing = countRes.ok ? await countRes.json() : {}
      const offset   = Array.isArray(existing) ? existing.length : existing.total ?? 0

      let created = 0, updated = 0, done = 0
      const CREATE_CHUNK = 500
      const UPDATE_CHUNK = 100

      // ── Bulk creates ────────────────────────────────────────────────────────
      for (let i = 0; i < toCreate.length; i += CREATE_CHUNK) {
        const chunk = toCreate.slice(i, i + CREATE_CHUNK)
        const contactPayloads = chunk.map((c, idx) => {
          const { color, colorSoft } = assignColor(offset + i + idx)
          return {
            first: c.first, last: c.last, title: c.title ?? null, headline: c.headline ?? null,
            company: c.company ?? null, email: c.email ?? null, phone: c.phone ?? null,
            birthday: c.birthday ?? null, closeness: c.closeness,
            tags: c.tags.split(",").map((t: string) => t.trim()).filter(Boolean),
            values: [], notes: c.notes ?? null, location: c.location ?? null,
            linkedin: c.linkedin ?? null, twitter: c.twitter ?? null, website: c.website ?? null,
            facebook: c.facebook ?? null, instagram: c.instagram ?? null,
            color, colorSoft, source: importMethod,
          }
        })

        const res = await fetch("/api/persons/bulk-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contacts: contactPayloads }),
        })
        const json = await requireSuccessfulImportResponse<{ created?: number }>(
          res,
          "Could not create these people. No records in this batch were changed.",
        )
        created += json.created ?? chunk.length
        done += chunk.length
        setImportProgress({ done, total: toProcess.length })
      }

      // ── Bulk updates ────────────────────────────────────────────────────────
      for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK) {
        const chunk = toUpdate.slice(i, i + UPDATE_CHUNK)
        const updatePayloads = chunk
          .filter(c => c.matchResult && Object.keys(c.matchResult.fillableFields).length > 0)
          .map(c => ({ id: c.matchResult!.personId, fields: c.matchResult!.fillableFields }))

        if (updatePayloads.length > 0) {
          const res = await fetch("/api/persons/bulk-update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: updatePayloads }),
          })
          const json = await requireSuccessfulImportResponse<{ updated?: number }>(
            res,
            "Could not update these people. No records in this batch were changed.",
          )
          updated += json.updated ?? updatePayloads.length
        }
        done += chunk.length
        setImportProgress({ done, total: toProcess.length })
      }

      setSavedCount(created)
      setUpdatedCount(updated)
      setImportProgress(null)
      setStep("done")
    } catch (e) {
      setImportProgress(null)
      setError(e instanceof Error ? `Import stopped: ${e.message}` : "Import stopped because saving failed.")
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
    setContacts(previous => setSelectedAt(previous, filteredPairs.map(pair => pair.globalIndex), target))
  }

  function clearSelection() {
    setContacts(clearReviewSelection)
  }

  function skipAllInFilter() {
    setContacts(previous => skipAt(previous, filteredPairs.filter(pair => !pair.contact.skip).map(pair => pair.globalIndex)))
  }

  function bulkSetAction(action: ContactAction) {
    setContacts(previous => setActionAt(previous, selectedPairs.map(pair => pair.globalIndex), action))
  }

  function bulkSkip() {
    setContacts(previous => skipAt(previous, selectedPairs.map(pair => pair.globalIndex)))
  }

  // Keep only selected contacts — skip everything else that isn't already skipped
  function bulkKeepOnly() {
    setContacts(previous => keepOnly(previous, selectedPairs.map(pair => pair.globalIndex)))
  }

  // Skip all contacts that don't pass the current field filter
  function skipNonMatching() {
    setContacts(previous => skipWhere(previous, contact => Array.from(requiredFields).some(key => {
      const chip = FIELD_CHIPS.find(field => field.key === key)
      return Boolean(chip && !chip.check(contact))
    })))
  }

  const filterKeys: FilterKey[] = ["all", "duplicate", "possible", "new", "review", "error"]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 24px 80px" }}>
      <a href="/import" style={{ fontSize: "11px", color: "var(--ink-4)", textDecoration: "none", display: "inline-block", marginBottom: "20px" }}>
        ← Import
      </a>

      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontFamily: "var(--font-display), serif", fontSize: "26px", fontWeight: 600, color: "var(--ink)", margin: "0 0 6px" }}>
          Import Persons
        </h1>
        <p style={{ color: "var(--ink-3)", fontSize: "12px", margin: 0 }}>
          Import from a spreadsheet, vCard, CSV, or your connected Google account.
        </p>
      </div>

      {/* ── Upload ── */}
      {step === "upload" && (
        <>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "10px 14px", marginBottom: "14px", fontSize: "11px", color: matchingStatus === "error" ? "var(--attention)" : "var(--ink-3)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <span>
              {matchingStatus === "loading" && "Preparing duplicate check across all existing people…"}
              {matchingStatus === "ready" && `Duplicate check ready · ${existingPersons.length.toLocaleString()} existing people loaded`}
              {matchingStatus === "error" && (matchingError ?? "Could not prepare duplicate checking.")}
            </span>
            {matchingStatus === "error" && (
              <button onClick={() => void loadMatchingPeople()} style={{ ...ghostBtnStyle, whiteSpace: "nowrap" }}>
                Retry
              </button>
            )}
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px 18px", marginBottom: "14px", fontSize: "12px", color: "var(--ink-2)", lineHeight: 1.7 }}>
            <div style={{ fontFamily: "var(--font-display), serif", fontSize: "14px", fontWeight: 500, color: "var(--ink)", marginBottom: "6px" }}>Import from file</div>
            <ol style={{ margin: 0, paddingLeft: "18px" }}>
              <li>Open your address book app</li>
              <li>Select people (⌘-click to multi-select)</li>
              <li><strong>File → Export → Export vCard…</strong></li>
              <li>Drop the .vcf below — or use any people spreadsheet with a name column</li>
            </ol>
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px 18px", marginBottom: "14px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "14px", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: "var(--font-display), serif", fontSize: "14px", fontWeight: 500, color: "var(--ink)", marginBottom: "5px" }}>Import Gmail Contacts</div>
              <div style={{ fontSize: "12px", color: "var(--ink-3)", lineHeight: 1.5 }}>
                Pull Google Contacts from the Gmail account you connected, then review them here before anything is saved.
              </div>
            </div>
            <button
              onClick={importGmailContacts}
              disabled={loading || matchingStatus !== "ready"}
              style={{ padding: "9px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "7px", cursor: loading || matchingStatus !== "ready" ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 500, opacity: loading || matchingStatus !== "ready" ? 0.55 : 1, whiteSpace: "nowrap" }}
            >
              Import Gmail Contacts
            </button>
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px 18px", marginBottom: "14px", fontSize: "12px", color: "var(--ink-2)", lineHeight: 1.7 }}>
            <div style={{ fontFamily: "var(--font-display), serif", fontSize: "14px", fontWeight: 500, color: "var(--ink)", marginBottom: "6px" }}>Import LinkedIn Connections</div>
            <div style={{ color: "var(--ink-3)", marginBottom: "8px" }}>
              LinkedIn has no API for this — the only real path is your own data export. It takes LinkedIn a few minutes to a few hours to prepare.
            </div>
            <ol style={{ margin: 0, paddingLeft: "18px" }}>
              <li>On LinkedIn: <strong>Settings → Data privacy → Get a copy of your data</strong></li>
              <li>Choose <strong>&quot;Want something in particular?&quot;</strong> and check just <strong>Connections</strong></li>
              <li>Request the archive — LinkedIn emails you when it&apos;s ready</li>
              <li>Unzip it and drop <strong>Connections.csv</strong> on the dropzone below</li>
            </ol>
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px 18px", marginBottom: "14px", fontSize: "12px", color: "var(--ink-2)", lineHeight: 1.7 }}>
            <div style={{ fontFamily: "var(--font-display), serif", fontSize: "14px", fontWeight: 500, color: "var(--ink)", marginBottom: "6px" }}>Import Instagram followers / following</div>
            <div style={{ color: "var(--ink-3)", marginBottom: "8px" }}>
              Instagram&apos;s export gives a username only — no real name, email, or phone — so these will need a quick glance in review before saving.
            </div>
            <ol style={{ margin: 0, paddingLeft: "18px", marginBottom: "10px" }}>
              <li>On Instagram: <strong>Settings → Accounts Center → Your information and permissions → Download your information</strong></li>
              <li>Choose <strong>&quot;Some of your information&quot;</strong> → <strong>Followers and following</strong>, format <strong>JSON</strong></li>
              <li>Download, unzip, and select the file(s) below — large accounts split into <code>followers_1.json</code>, <code>followers_2.json</code>, etc; you can select them all at once</li>
            </ol>
            <input
              ref={instagramInputRef}
              type="file"
              accept=".json"
              multiple
              disabled={matchingStatus !== "ready"}
              onChange={handleInstagramInput}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => { setInstagramRelationship("follower"); instagramInputRef.current?.click() }}
                disabled={loading || matchingStatus !== "ready"}
                style={{ padding: "8px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "7px", cursor: loading || matchingStatus !== "ready" ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 500, opacity: loading || matchingStatus !== "ready" ? 0.55 : 1 }}
              >
                Import followers_*.json
              </button>
              <button
                onClick={() => { setInstagramRelationship("following"); instagramInputRef.current?.click() }}
                disabled={loading || matchingStatus !== "ready"}
                style={{ ...ghostBtnStyle, opacity: loading || matchingStatus !== "ready" ? 0.55 : 1, cursor: loading || matchingStatus !== "ready" ? "not-allowed" : "pointer" }}
              >
                Import following.json
              </button>
            </div>
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px 18px", marginBottom: "14px", fontSize: "12px", color: "var(--ink-3)", lineHeight: 1.7 }}>
            <div style={{ fontFamily: "var(--font-display), serif", fontSize: "14px", fontWeight: 500, color: "var(--ink)", marginBottom: "6px" }}>About X / Twitter</div>
            <div>
              X&apos;s own data export (Settings → Your account → Download an archive) only lists numeric account IDs for who you follow — no usernames or names, so there&apos;s nothing importable in it. If you already have a CSV with X handles from somewhere else, the dropzone below will read it like any other CSV.
            </div>
          </div>

          <div
            onDragOver={e => { e.preventDefault(); if (matchingStatus === "ready") setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !loading && matchingStatus === "ready" && inputRef.current?.click()}
            style={{ border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`, borderRadius: "12px", padding: "48px 24px", textAlign: "center", cursor: loading ? "wait" : matchingStatus === "ready" ? "pointer" : "not-allowed", background: dragging ? "var(--accent-soft)" : "var(--surface)", transition: "all 0.15s", opacity: matchingStatus === "ready" ? 1 : 0.6 }}
          >
            <input ref={inputRef} type="file" accept=".vcf,.csv,.xlsx" disabled={matchingStatus !== "ready"} onChange={handleFileInput} style={{ display: "none" }} />
            {loading ? (
              <>
                <div style={{ width: "32px", height: "32px", border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                <div style={{ color: "var(--ink-3)", fontSize: "12px" }}>{loadingMsg}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "28px", marginBottom: "10px", color: "var(--ink-4)" }}>↑</div>
                <div style={{ color: "var(--ink)", fontSize: "13px", marginBottom: "5px" }}>
                  {matchingStatus === "ready" ? "Drop your people file here" : "Waiting for duplicate checking"}
                </div>
                <div style={{ color: "var(--ink-4)", fontSize: "11px" }}>.xlsx  ·  .vcf  ·  .csv (Google, LinkedIn, generic)</div>
              </>
            )}
          </div>
          {error && (
            <div style={{ color: "var(--accent)", fontSize: "12px", marginTop: "12px", display: "grid", gap: "8px" }}>
              <div>{error}</div>
              {gmailReconnectUrl && (
                <a href={gmailReconnectUrl} style={{ color: "var(--accent)", textDecoration: "underline" }}>
                  Reconnect Gmail with Contacts access →
                </a>
              )}
            </div>
          )}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      )}

      {/* ── Review ── */}
      {step === "review" && stats && (
        <>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <div>
              <h2 style={{ fontFamily: "var(--font-display), serif", fontSize: "18px", fontWeight: 600, margin: "0 0 2px", color: "var(--ink)" }}>
                {contacts.length} people found
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
          {spreadsheetSummary && (
            <div style={{ marginBottom: "12px", padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", fontSize: "11px", color: "var(--ink-3)", lineHeight: 1.55 }}>
              <div style={{ fontFamily: "var(--font-display), serif", fontSize: "14px", color: "var(--ink)", marginBottom: "3px" }}>
                Spreadsheet understood
              </div>
              <div>
                Found {spreadsheetSummary.peopleTables.reduce((total, table) => total + table.people, 0)} people in{" "}
                {spreadsheetSummary.peopleTables.map(table => table.sheet).join(", ")}. Row-specific details are included in each person&apos;s editable Notes.
              </div>
              {spreadsheetSummary.ignoredSheets.length > 0 && (
                <div style={{ color: "var(--ink-4)", marginTop: "4px" }}>
                  Left ambiguous sheet{spreadsheetSummary.ignoredSheets.length === 1 ? "" : "s"} untouched: {spreadsheetSummary.ignoredSheets.join(", ")}.
                </div>
              )}
            </div>
          )}

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
                    Show only people with…
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
                      <span style={{ color: "var(--ink)", fontWeight: 500 }}>{filteredPairs.length}</span> of {contacts.filter(c => !c.skip).length} active people match
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
                  No people in this filter.
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
        <div style={{ textAlign: "center", padding: "64px 32px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }}>
          <div style={{ fontSize: "40px", marginBottom: "16px" }}>✓</div>
          <h2 style={{ fontFamily: "var(--font-display), serif", fontSize: "26px", fontWeight: 600, color: "var(--ink)", margin: "0 0 10px" }}>
            Import complete
          </h2>
          <p style={{ color: "var(--ink-3)", fontSize: "14px", marginBottom: "6px" }}>
            {savedCount > 0 && <span><strong style={{ color: "var(--ink)" }}>{savedCount.toLocaleString()}</strong> people added</span>}
            {savedCount > 0 && updatedCount > 0 && <span style={{ color: "var(--ink-4)" }}> · </span>}
            {updatedCount > 0 && <span><strong style={{ color: "var(--ink)" }}>{updatedCount.toLocaleString()}</strong> existing updated</span>}
            {savedCount === 0 && updatedCount === 0 && <span>Nothing was imported.</span>}
          </p>
          <p style={{ color: "var(--ink-4)", fontSize: "12px", marginBottom: "32px" }}>Your people list is ready.</p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            <button
              onClick={() => router.push("/persons")}
              style={{ padding: "12px 32px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit", fontSize: "14px", fontWeight: 600 }}
            >
              Go to Persons →
            </button>
            <button onClick={() => { setStep("upload"); setContacts([]) }} style={{ padding: "12px 24px", background: "transparent", color: "var(--ink-3)", border: "1px solid var(--border)", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}>
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
          padding: importProgress ? "10px 24px" : "12px 24px",
          display: "flex", alignItems: "center",
          justifyContent: "space-between", zIndex: 40,
          boxShadow: "0 -4px 16px rgba(26,24,20,0.07)",
          flexDirection: importProgress ? "column" : "row",
          gap: importProgress ? "8px" : "0",
        }}>
          {importProgress ? (
            <>
              <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: "var(--ink-2)", fontWeight: 500 }}>
                  Importing… {importProgress.done.toLocaleString()} / {importProgress.total.toLocaleString()}
                </span>
                <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>
                  {Math.round((importProgress.done / importProgress.total) * 100)}%
                </span>
              </div>
              <div style={{ width: "100%", height: "6px", background: "var(--surface2)", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.round((importProgress.done / importProgress.total) * 100)}%`,
                  background: "var(--accent)",
                  borderRadius: "3px",
                  transition: "width 0.3s ease",
                }} />
              </div>
            </>
          ) : (
            <>
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
                  style={{ padding: "8px 20px", background: activeCount > 0 ? "var(--accent)" : "var(--border)", color: activeCount > 0 ? "#fff" : "var(--ink-4)", border: "none", borderRadius: "7px", cursor: activeCount > 0 && !saving ? "pointer" : "not-allowed", fontFamily: "inherit", fontSize: "12px", fontWeight: 500 }}
                >
                  {`Import ${activeCount}`}
                </button>
              </div>
            </>
          )}
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


const ghostBtnStyle: React.CSSProperties = {
  padding: "6px 13px", borderRadius: "6px", border: "1px solid var(--border)",
  background: "transparent", color: "var(--ink-3)", cursor: "pointer", fontFamily: "inherit", fontSize: "11px",
}
