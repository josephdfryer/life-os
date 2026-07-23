"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import ProcessingState from "@/components/import/ProcessingState"
import ResultCard from "@/components/import/ResultCard"
import type { ImportedPerson } from "@/types"

type Step = "input" | "processing" | "resolve" | "review" | "done"

type ContactRef = {
  id: string
  first: string
  last: string
  title: string | null
  headline: string | null
  email: string | null
  phone: string | null
}

const ACCEPTED = [".json", ".txt", ".mbox", ".pdf", ".csv", ".html", ".xml", ".md"]
const GMAIL_BACKFILL_OPTIONS = [
  { value: "7", label: "Past 7 days" },
  { value: "30", label: "Past 30 days" },
  { value: "90", label: "Past 90 days" },
  { value: "180", label: "Past 6 months" },
  { value: "365", label: "Past year" },
  { value: "730", label: "Past 2 years" },
  { value: "3650", label: "Past 10 years" },
  { value: "36500", label: "All time" },
] as const

export default function ImportInteractionsPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("input")
  const [text, setText] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [results, setResults] = useState<ImportedPerson[]>([])
  const [existingContacts, setExistingContacts] = useState<ContactRef[]>([])
  const [unresolvedQueue, setUnresolvedQueue] = useState<number[]>([])
  const [fileDataForStore, setFileDataForStore] = useState<{ name: string; format: string; content: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [mailImporting, setMailImporting] = useState(false)
  const [gmailBackfillDays, setGmailBackfillDays] = useState("30")
  const [gmailUnmatchedMode, setGmailUnmatchedMode] = useState<"skip" | "stage">("skip")
  const [gmailImportResult, setGmailImportResult] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(incoming: File[]) {
    if (!incoming.length) return
    const firstFile = incoming[0]
    if (firstFile.name.endsWith(".vcf")) {
      router.push("/import/persons")
      return
    }
    setFiles(incoming)
    setError(null)
    try {
      const content = await readFiles(incoming)
      setText(content)
    } catch (e) {
      setError(`Could not read file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length) handleFiles(dropped)
  }

  async function handleAnalyze() {
    let content = text.trim()

    // If text didn't populate (e.g. silent read failure), try reading files again
    if (!content && files.length > 0) {
      try {
        content = (await readFiles(files)).trim()
        setText(content)
      } catch (e) {
        setError(`Could not read file: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
    }

    if (!content) {
      setError("Paste some content or drop a file to get started.")
      return
    }
    setError(null)
    setStep("processing")
    setFileDataForStore(
      files.length ? { name: files[0].name, format: "auto", content } : null
    )

    try {
      // Fetch existing people to pass to Claude for matching
      const contactsRes = await fetch("/api/persons?minimal=true&limit=200")
      const contactsData = contactsRes.ok ? await contactsRes.json() : {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contacts: ContactRef[] = (contactsData.persons ?? []).map((p: any) => ({
        id: p.id,
        first: p.first,
        last: p.last,
        title: p.title ?? null,
        headline: p.headline ?? null,
        email: Array.isArray(p.emails) ? (p.emails[0] ?? null) : null,
        phone: Array.isArray(p.phones) ? (p.phones[0] ?? null) : null,
      }))
      setExistingContacts(contacts)

      const res = await fetch("/api/import/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          filename: files[0]?.name ?? "pasted content",
          existingContacts: contacts,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Analysis failed")

      const parsed: ImportedPerson[] = data.results

      // Deterministic fallback: run Jaro-Winkler on persons Claude didn't match
      const enriched: ImportedPerson[] = parsed.map(r => {
        if (r.matchedPersonId || contacts.length === 0) return r
        const match = findBestContactMatch(r.name, contacts)
        if (!match) return r
        if (match.score >= 0.95) {
          return {
            ...r,
            isNew: false,
            matchedPersonId: match.contact.id,
            matchedPersonName: `${match.contact.first} ${match.contact.last}`,
          }
        }
        // Medium confidence — flag for manual review so suggestions appear
        return { ...r, needsReview: true }
      })

      // Find persons that need manual resolution:
      // - Claude thinks they exist but couldn't find a match
      // - Flagged needsReview (ambiguous or medium-confidence fuzzy match)
      const needsResolution = enriched
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => !r.matchedPersonId && (!r.isNew || r.needsReview))
        .map(({ i }) => i)

      setResults(enriched)

      if (needsResolution.length > 0) {
        setUnresolvedQueue(needsResolution)
        setStep("resolve")
      } else {
        setStep("review")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed")
      setStep("input")
    }
  }

  function resolveWithContact(resultIdx: number, contact: ContactRef) {
    setResults(prev => prev.map((r, i) =>
      i === resultIdx
        ? { ...r, matchedPersonId: contact.id, matchedPersonName: `${contact.first} ${contact.last}`, isNew: false, needsReview: false }
        : r
    ))
    advanceQueue()
  }

  function resolveAsNew(resultIdx: number) {
    setResults(prev => prev.map((r, i) =>
      i === resultIdx
        ? { ...r, isNew: true, matchedPersonId: null, matchedPersonName: null }
        : r
    ))
    advanceQueue()
  }

  function advanceQueue() {
    setUnresolvedQueue(prev => {
      const next = prev.slice(1)
      if (next.length === 0) setStep("review")
      return next
    })
  }

  async function handleConfirm() {
    setConfirming(true)
    setError(null)
    try {
      const res = await fetch("/api/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results, fileData: fileDataForStore }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Import failed")
      setStep("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setConfirming(false)
    }
  }

  async function importGmailMail() {
    setMailImporting(true)
    setError(null)
    setGmailImportResult(null)
    try {
      const res = await fetch("/api/gmail/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backfillDays: Number(gmailBackfillDays),
          unmatchedMode: gmailUnmatchedMode,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || data.error || "Could not import Gmail mail")
      setGmailImportResult(JSON.stringify(data, null, 2))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import Gmail mail")
    } finally {
      setMailImporting(false)
    }
  }

  const currentUnresolvedIdx = unresolvedQueue[0] ?? null
  const currentUnresolved = currentUnresolvedIdx !== null ? results[currentUnresolvedIdx] : null

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 24px" }}>

        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontFamily: "var(--font-display), serif", fontSize: "28px", fontWeight: 600, color: "var(--ink)", margin: "0 0 6px" }}>
            Import Interactions
          </h1>
          <p style={{ color: "var(--ink-3)", fontSize: "12px", margin: 0 }}>
            Drop anything: Slack, iMessage, email, meeting notes, WhatsApp, or synced Gmail mail.
          </p>
        </div>

        {step === "input" && (
          <>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px 18px", marginBottom: "14px", display: "grid", gap: "13px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "14px", alignItems: "start" }}>
                <div>
                  <div style={{ fontFamily: "var(--font-display), serif", fontSize: "14px", fontWeight: 500, color: "var(--ink)", marginBottom: "5px" }}>Import Gmail Mail</div>
                  <div style={{ fontSize: "12px", color: "var(--ink-3)", lineHeight: 1.5 }}>
                    Sync email from the connected Gmail account into Interactions. It runs in batches, uses Gmail history after the first import, and defaults to Known People only.
                  </div>
                </div>
                <a
                  href="/api/gmail/google/connect?returnTo=/import/interactions"
                  style={{ padding: "8px 11px", border: "1px solid var(--border)", borderRadius: "7px", color: "var(--ink-2)", textDecoration: "none", fontSize: "12px", whiteSpace: "nowrap" }}
                >
                  Connect Gmail
                </a>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", alignItems: "end" }}>
                <label style={{ display: "grid", gap: "5px" }}>
                  <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>Backfill range</span>
                  <select
                    value={gmailBackfillDays}
                    onChange={event => setGmailBackfillDays(event.target.value)}
                    style={{ height: "34px", border: "1px solid var(--border)", borderRadius: "7px", background: "var(--bg)", color: "var(--ink)", padding: "0 9px", fontFamily: "inherit", fontSize: "12px" }}
                  >
                    {GMAIL_BACKFILL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label style={{ display: "grid", gap: "5px" }}>
                  <span style={{ fontSize: "10px", color: "var(--ink-4)" }}>Unmatched email</span>
                  <select
                    value={gmailUnmatchedMode}
                    onChange={event => setGmailUnmatchedMode(event.target.value === "stage" ? "stage" : "skip")}
                    style={{ height: "34px", border: "1px solid var(--border)", borderRadius: "7px", background: "var(--bg)", color: "var(--ink)", padding: "0 9px", fontFamily: "inherit", fontSize: "12px" }}
                  >
                    <option value="skip">Known People only</option>
                    <option value="stage">Stage unmatched in Inbox</option>
                  </select>
                </label>
                <button
                  onClick={importGmailMail}
                  disabled={mailImporting}
                  style={{ height: "34px", padding: "0 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "7px", cursor: mailImporting ? "wait" : "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 500, opacity: mailImporting ? 0.7 : 1 }}
                >
                  {mailImporting ? "Importing..." : "Import Gmail Mail"}
                </button>
              </div>

              {gmailImportResult && (
                <div>
                  <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "5px" }}>Last Gmail import result</div>
                  <pre style={{ margin: 0, padding: "10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink-2)", fontSize: "11px", lineHeight: 1.5, overflow: "auto" }}>{gmailImportResult}</pre>
                </div>
              )}
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "12px",
                padding: "32px 24px",
                textAlign: "center",
                cursor: "pointer",
                background: dragging ? "var(--accent-soft)" : "transparent",
                transition: "all 0.15s",
                marginBottom: "16px",
              }}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPTED.join(",")}
                onChange={e => { if (e.target.files) handleFiles(Array.from(e.target.files)); e.target.value = "" }}
                style={{ display: "none" }}
              />
              <div style={{ fontSize: "22px", marginBottom: "8px", color: "var(--ink-4)" }}>↑</div>
              <div style={{ color: "var(--ink)", fontSize: "13px", marginBottom: "4px" }}>
                Drop a file or click to browse
              </div>
              <div style={{ color: "var(--ink-4)", fontSize: "11px" }}>
                {ACCEPTED.join("  ·  ")}
              </div>
            </div>

            {files.length > 0 && (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "7px",
                marginBottom: "14px",
                fontSize: "11px",
                color: "var(--ink-3)",
              }}>
                <span>📄</span>
                <span>{files.map(f => f.name).join(", ")}</span>
                <button
                  onClick={() => { setFiles([]); setText("") }}
                  style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--ink-4)", cursor: "pointer", fontSize: "13px", padding: "0 2px" }}
                >×</button>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
              <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
              <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>or paste directly</span>
              <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
            </div>

            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste anything: Slack export, iMessage thread, email chain, WhatsApp conversation, meeting notes..."
              rows={10}
              style={{
                width: "100%",
                padding: "14px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                color: "var(--ink)",
                fontFamily: "inherit",
                fontSize: "12px",
                lineHeight: 1.6,
                resize: "vertical",
                marginBottom: "16px",
                boxSizing: "border-box",
              }}
            />

            {error && <p style={{ color: "var(--accent)", fontSize: "12px", marginBottom: "12px" }}>{error}</p>}

            <button
              onClick={handleAnalyze}
              disabled={!text.trim() && files.length === 0}
              style={{
                width: "100%",
                padding: "14px",
                background: (text.trim() || files.length > 0) ? "var(--accent)" : "var(--border)",
                color: (text.trim() || files.length > 0) ? "#fff" : "var(--ink-4)",
                border: "none",
                borderRadius: "8px",
                cursor: (text.trim() || files.length > 0) ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                fontSize: "13px",
                fontWeight: 500,
                transition: "background 0.15s",
              }}
            >
              Analyze with Claude
            </button>
          </>
        )}

        {step === "processing" && <ProcessingState />}

        {step === "resolve" && currentUnresolved && currentUnresolvedIdx !== null && (
          <ResolveModal
            person={currentUnresolved}
            contacts={existingContacts}
            remaining={unresolvedQueue.length}
            onMatch={contact => resolveWithContact(currentUnresolvedIdx, contact)}
            onNew={() => resolveAsNew(currentUnresolvedIdx)}
          />
        )}

        {step === "review" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <h2 style={{ fontFamily: "var(--font-display), serif", fontSize: "20px", fontWeight: 600, margin: 0, color: "var(--ink)" }}>
                Review Results
                <span style={{ fontSize: "13px", fontWeight: 400, color: "var(--ink-3)", marginLeft: "8px" }}>
                  {results.length} people found
                </span>
              </h2>
              <button
                onClick={() => setStep("input")}
                style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", color: "var(--ink-3)", cursor: "pointer", fontFamily: "inherit", fontSize: "11px" }}
              >
                Back
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
              {results.map((result, i) => (
                <ResultCard
                  key={i}
                  result={result}
                  index={i}
                  onChange={updated => setResults(prev => prev.map((r, idx) => idx === i ? updated : r))}
                />
              ))}
            </div>

            {error && <p style={{ color: "var(--accent)", fontSize: "12px", marginBottom: "12px" }}>{error}</p>}

            <button
              onClick={handleConfirm}
              disabled={confirming}
              style={{
                width: "100%",
                padding: "14px",
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: confirming ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                fontSize: "13px",
                fontWeight: 500,
                opacity: confirming ? 0.7 : 1,
              }}
            >
              {confirming ? "Importing…" : `Confirm Import (${results.length} people)`}
            </button>
          </>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", padding: "60px 32px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }}>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>✓</div>
            <h2 style={{ fontFamily: "var(--font-display), serif", fontSize: "22px", fontWeight: 600, color: "var(--ink)", margin: "0 0 8px" }}>
              Import Complete
            </h2>
            <p style={{ color: "var(--ink-3)", fontSize: "13px", marginBottom: "24px" }}>
              {results.length} people and their interactions have been added.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
              <button onClick={() => router.push("/persons")} style={{ padding: "10px 24px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "7px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: 500 }}>
                View People
              </button>
              <button
                onClick={() => { setStep("input"); setText(""); setFiles([]); setResults([]); setError(null) }}
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

// ─── Jaro-Winkler helpers ─────────────────────────────────────────────────────

function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const len1 = s1.length, len2 = s2.length
  if (!len1 || !len2) return 0
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0)
  const s1m = new Array(len1).fill(false)
  const s2m = new Array(len2).fill(false)
  let matches = 0
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - matchDist)
    const hi = Math.min(i + matchDist + 1, len2)
    for (let j = lo; j < hi; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue
      s1m[i] = true; s2m[j] = true; matches++; break
    }
  }
  if (!matches) return 0
  let t = 0, k = 0
  for (let i = 0; i < len1; i++) {
    if (!s1m[i]) continue
    while (!s2m[k]) k++
    if (s1[i] !== s2[k]) t++
    k++
  }
  return (matches / len1 + matches / len2 + (matches - t / 2) / matches) / 3
}

function jaroWinkler(s1: string, s2: string): number {
  const j = jaro(s1, s2)
  let prefix = 0
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++; else break
  }
  return j + prefix * 0.1 * (1 - j)
}

function normStr(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "")
}

function findBestContactMatch(name: string, contacts: ContactRef[]): { contact: ContactRef; score: number } | null {
  const n = normStr(name)
  let best: { contact: ContactRef; score: number } | null = null
  for (const c of contacts) {
    const score = jaroWinkler(n, normStr(`${c.first} ${c.last}`))
    if (!best || score > best.score) best = { contact: c, score }
  }
  return best && best.score >= 0.82 ? best : null
}

// ─── Resolve Modal ────────────────────────────────────────────────────────────

function getSuggestions(name: string, contacts: ContactRef[]): ContactRef[] {
  const n = normStr(name)
  return contacts
    .map(c => ({ c, score: jaroWinkler(n, normStr(`${c.first} ${c.last}`)) }))
    .filter(({ score }) => score >= 0.65)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ c }) => c)
}

function ResolveModal({
  person,
  contacts,
  remaining,
  onMatch,
  onNew,
}: {
  person: ImportedPerson
  contacts: ContactRef[]
  remaining: number
  onMatch: (c: ContactRef) => void
  onNew: () => void
}) {
  const suggestions = getSuggestions(person.name, contacts)
  // Pre-fill with the person's name when there are no fuzzy suggestions (first-name-only case)
  const [search, setSearch] = useState(suggestions.length === 0 ? person.name : "")
  const [apiResults, setApiResults] = useState<ContactRef[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!search.trim()) { setApiResults([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/persons?minimal=true&search=${encodeURIComponent(search)}&limit=8`)
        const data = res.ok ? await res.json() : {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setApiResults((data.persons ?? []).map((p: any) => ({
          id: p.id, first: p.first, last: p.last,
          title: p.title ?? null,
          headline: p.headline ?? null,
          email: Array.isArray(p.emails) ? (p.emails[0] ?? null) : null,
          phone: Array.isArray(p.phones) ? (p.phones[0] ?? null) : null,
        })))
      } catch { setApiResults([]) }
      finally { setSearching(false) }
    }, 200)
    return () => clearTimeout(t)
  }, [search])

  const showList = search.trim() ? apiResults : suggestions

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "12px",
      padding: "28px 28px 24px",
      maxWidth: "480px",
      margin: "0 auto",
    }}>
      {remaining > 1 && (
        <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "14px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {remaining} to resolve
        </div>
      )}

      <h2 style={{ fontFamily: "var(--font-display), serif", fontSize: "20px", fontWeight: 600, color: "var(--ink)", margin: "0 0 6px" }}>
        Who is "{person.name}"?
      </h2>
      <p style={{ fontSize: "12px", color: "var(--ink-3)", margin: "0 0 20px", lineHeight: 1.5 }}>
        {contacts.length > 0
          ? "This person was not automatically matched. Pick an existing Person or add them as new."
          : "No existing people to match against. Add as a new person?"}
      </p>

      {contacts.length > 0 && (
        <>
          {suggestions.length > 0 && !search && (
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "10px", color: "var(--ink-4)", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "7px" }}>
                Suggestions
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {suggestions.map(c => (
                  <ContactRow key={c.id} contact={c} onClick={() => onMatch(c)} />
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: "16px" }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search all people…"
              autoFocus={suggestions.length === 0}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "7px",
                color: "var(--ink)",
                fontFamily: "inherit",
                fontSize: "12px",
                boxSizing: "border-box",
              }}
            />
            {search && (
              <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "7px" }}>
                {searching
                  ? <div style={{ fontSize: "11px", color: "var(--ink-4)", padding: "6px 0" }}>Searching…</div>
                  : apiResults.length > 0
                    ? apiResults.map(c => (
                        <ContactRow key={c.id} contact={c} onClick={() => onMatch(c)} />
                      ))
                    : <div style={{ fontSize: "11px", color: "var(--ink-4)", padding: "6px 0" }}>No people found.</div>
                }
              </div>
            )}
          </div>
        </>
      )}

      <button
        onClick={onNew}
        style={{
          width: "100%",
          padding: "10px",
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          borderRadius: "7px",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "12px",
          fontWeight: 500,
        }}
      >
        Add "{person.name}" as new Person
      </button>
    </div>
  )
}

function ContactRow({ contact, onClick }: { contact: ContactRef; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "9px 12px",
        background: hovered ? "var(--accent-soft)" : "var(--surface2)",
        border: `1px solid ${hovered ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "7px",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        width: "100%",
        transition: "all 0.1s",
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: hovered ? "var(--accent)" : "var(--border)",
        color: hovered ? "#fff" : "var(--ink-3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "10px", fontWeight: 600, flexShrink: 0,
        transition: "all 0.1s",
      }}>
        {contact.first[0]}{contact.last[0]}
      </div>
      <div>
        <div style={{ fontSize: "12px", fontWeight: 500, color: hovered ? "var(--accent)" : "var(--ink)" }}>
          {contact.first} {contact.last}
        </div>
        {(contact.title || contact.headline) && (
          <div style={{ fontSize: "10px", color: "var(--ink-4)" }}>{contact.title ?? contact.headline}</div>
        )}
      </div>
    </button>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readFiles(files: File[]): Promise<string> {
  const contents = await Promise.all(files.map(f => f.text()))
  return contents.join("\n\n---\n\n")
}
