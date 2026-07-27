"use client"

import { FormEvent, useEffect, useRef, useState } from "react"

type CaptureType = "thought" | "observation" | "declaration"
type CaptureStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; message: string; noteId: string }
  | { kind: "error"; message: string }

type SuggestedPerson = { id: string; name: string }
type Suggestion = {
  id: string
  kind: "plan" | "event"
  status: string
  title: string
  confidence: number | null
  payload: {
    timestamp: string | null
    personNames: string[]
    matchedPeople: SuggestedPerson[]
    reason: string
  }
}
type AnalysisStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string; configuration: boolean }
  | { kind: "done"; modelId: string; estimatedCost: number | null; suggestions: Suggestion[] }

type SpeechRecognitionEventLike = { results: ArrayLike<{ 0: { transcript: string } }> }
type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

export default function QuickCapture() {
  const [content, setContent] = useState("")
  const [type, setType] = useState<CaptureType>("thought")
  const [status, setStatus] = useState<CaptureStatus>({ kind: "idle" })
  const [analysis, setAnalysis] = useState<AnalysisStatus>({ kind: "idle" })
  const [dictationAvailable, setDictationAvailable] = useState(false)
  const [dictating, setDictating] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const requestKeyRef = useRef<string | null>(null)

  useEffect(() => {
    function focusFromHash() {
      if (window.location.hash === "#quick-capture") textareaRef.current?.focus()
    }
    focusFromHash()
    window.addEventListener("hashchange", focusFromHash)
    return () => window.removeEventListener("hashchange", focusFromHash)
  }, [])

  useEffect(() => {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor
      webkitSpeechRecognition?: SpeechRecognitionConstructor
    }
    setDictationAvailable(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition))
  }, [])

  function toggleDictation() {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor
      webkitSpeechRecognition?: SpeechRecognitionConstructor
    }
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Recognition || dictating) return
    const recognition = new Recognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = navigator.language || "en-US"
    recognition.onresult = event => {
      const transcript = Array.from(event.results).map(result => result[0]?.transcript ?? "").join(" ").trim()
      if (transcript) setContent(current => [current.trim(), transcript].filter(Boolean).join(" "))
    }
    recognition.onend = () => setDictating(false)
    recognition.onerror = () => setDictating(false)
    setDictating(true)
    recognition.start()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = content.trim()
    if (!value || status.kind === "saving") return

    setStatus({ kind: "saving" })
    const idempotencyKey = requestKeyRef.current ?? crypto.randomUUID()
    requestKeyRef.current = idempotencyKey
    try {
      const response = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value, type, idempotencyKey }),
      })
      const body = await response.json().catch(() => null) as { id?: string; error?: string } | null
      if (!response.ok) throw new Error(body?.error || "Capture could not be saved")
      if (!body?.id) throw new Error("Capture saved without a Note identifier")
      setContent("")
      requestKeyRef.current = null
      setAnalysis({ kind: "idle" })
      setStatus({ kind: "saved", message: "Saved to your Notes.", noteId: body.id })
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Capture could not be saved",
      })
    }
  }

  async function findStructure() {
    if (status.kind !== "saved" || analysis.kind === "loading") return
    setAnalysis({ kind: "loading" })
    try {
      const response = await fetch(`/api/capture/${status.noteId}/suggestions`, { method: "POST" })
      const body = await response.json().catch(() => null) as {
        error?: string
        code?: string
        modelId?: string
        usage?: { estimatedCost?: number | null }
        suggestions?: Suggestion[]
      } | null
      if (!response.ok) {
        setAnalysis({
          kind: "error",
          message: body?.error || "Structure analysis failed",
          configuration: body?.code === "configuration",
        })
        return
      }
      setAnalysis({
        kind: "done",
        modelId: body?.modelId || "AI Gateway",
        estimatedCost: body?.usage?.estimatedCost ?? null,
        suggestions: body?.suggestions ?? [],
      })
    } catch (error) {
      setAnalysis({
        kind: "error",
        message: error instanceof Error ? error.message : "Structure analysis failed",
        configuration: false,
      })
    }
  }

  function updateSuggestion(id: string, patch: Partial<Suggestion>) {
    setAnalysis(current => current.kind === "done"
      ? {
          ...current,
          suggestions: current.suggestions.map(suggestion =>
            suggestion.id === id ? { ...suggestion, ...patch } : suggestion),
        }
      : current)
  }

  return (
    <section id="quick-capture" className="quick-capture" aria-labelledby="quick-capture-heading">
      <div className="quick-capture-heading">
        <div>
          <div className="quick-capture-eyebrow">Remember this for me</div>
          <h2 id="quick-capture-heading">Quick capture</h2>
        </div>
        <div className="quick-capture-hint">⌘ Enter to save</div>
      </div>

      <form onSubmit={submit}>
        <label htmlFor="quick-capture-content" className="sr-only">What should Life OS remember?</label>
        <textarea
          id="quick-capture-content"
          ref={textareaRef}
          value={content}
          onChange={event => {
            setContent(event.target.value)
            requestKeyRef.current = null
            setAnalysis({ kind: "idle" })
            if (status.kind !== "idle" && status.kind !== "saving") setStatus({ kind: "idle" })
          }}
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.currentTarget.form?.requestSubmit()
            }
          }}
          maxLength={10_000}
          placeholder="Lunch with Alex was great — follow up about his new company…"
          rows={3}
        />

        <div className="quick-capture-footer">
          <div>
          <div className="quick-capture-types" aria-label="Capture type">
            {([
              ["thought", "Thought"],
              ["observation", "Observation"],
              ["declaration", "Declaration"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={type === value ? "capture-type active" : "capture-type"}
                aria-pressed={type === value}
                onClick={() => setType(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {dictationAvailable && (
            <button type="button" className="capture-dictation" disabled={dictating} onClick={toggleDictation}>
              {dictating ? "Listening…" : "Browser dictation"}
            </button>
          )}
          </div>
          <button
            type="submit"
            className="capture-submit"
            disabled={!content.trim() || status.kind === "saving"}
          >
            {status.kind === "saving" ? "Saving…" : "Save note"}
          </button>
        </div>
      </form>
      {dictationAvailable && (
        <div className="capture-privacy-note">
          Dictation uses your browser&apos;s speech service and may send audio to its vendor. Review the text before saving.
        </div>
      )}

      <div
        className={status.kind === "error" ? "capture-status error" : "capture-status"}
        role={status.kind === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {status.kind === "saved" || status.kind === "error" ? status.message : ""}
      </div>

      {status.kind === "saved" && analysis.kind === "idle" && (
        <div className="capture-structure-prompt">
          <div>
            <strong>Want help organizing it?</strong>
            <span> A paid model call can suggest Plans or Events. Nothing is created without your approval.</span>
          </div>
          <button type="button" className="capture-secondary" onClick={findStructure}>
            Find structure
          </button>
        </div>
      )}

      {analysis.kind === "loading" && (
        <div className="capture-analysis-status" role="status">Looking only for explicit Plans or Events…</div>
      )}

      {analysis.kind === "error" && (
        <div className="capture-analysis-status error" role="alert">
          {analysis.message}
          {analysis.configuration && (
            <> <a href="https://stuff.lacollecteur.com/wardrobe">Connect an AI Gateway key</a>.</>
          )}
        </div>
      )}

      {analysis.kind === "done" && (
        <div className="capture-suggestions">
          <div className="capture-suggestions-meta">
            <span>{analysis.suggestions.length ? "Suggested structure" : "No structure suggested"}</span>
            <span>
              {analysis.modelId}
              {analysis.estimatedCost !== null ? ` · $${analysis.estimatedCost.toFixed(4)}` : ""}
            </span>
          </div>
          {analysis.suggestions.length === 0 ? (
            <div className="capture-analysis-status">The Note is saved as-is. No Plan or Event was warranted.</div>
          ) : analysis.suggestions.map(suggestion => (
            <SuggestionEditor
              key={suggestion.id}
              suggestion={suggestion}
              onChange={patch => updateSuggestion(suggestion.id, patch)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function SuggestionEditor({
  suggestion,
  onChange,
}: {
  suggestion: Suggestion
  onChange: (patch: Partial<Suggestion>) => void
}) {
  const [title, setTitle] = useState(suggestion.title)
  const [timestamp, setTimestamp] = useState(toLocalDateTimeValue(suggestion.payload.timestamp))
  const [personIds, setPersonIds] = useState(() => suggestion.payload.matchedPeople.map(person => person.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const unmatchedNames = suggestion.payload.personNames.filter(name =>
    !suggestion.payload.matchedPeople.some(person => person.name.toLocaleLowerCase() === name.toLocaleLowerCase()))

  async function review(action: "accept" | "dismiss") {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/capture/suggestions/${suggestion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          title,
          timestamp: timestamp ? new Date(timestamp).toISOString() : null,
          personIds,
        }),
      })
      const body = await response.json().catch(() => null) as { error?: string; status?: string } | null
      if (!response.ok) throw new Error(body?.error || "Suggestion could not be reviewed")
      onChange({ status: body?.status || action })
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Suggestion could not be reviewed")
    } finally {
      setBusy(false)
    }
  }

  if (suggestion.status === "accepted" || suggestion.status === "dismissed") {
    return (
      <div className={`capture-suggestion resolved ${suggestion.status}`}>
        <span>{suggestion.title}</span>
        <strong>{suggestion.status === "accepted" ? "Accepted" : "Dismissed"}</strong>
      </div>
    )
  }

  return (
    <div className="capture-suggestion">
      <div className="capture-suggestion-kind">
        <span>{suggestion.kind === "plan" ? "Plan" : "Event"}</span>
        {suggestion.confidence !== null && <span>{Math.round(suggestion.confidence * 100)}% confidence</span>}
      </div>
      <label>
        <span>Title</span>
        <input value={title} onChange={event => setTitle(event.target.value)} maxLength={240} />
      </label>
      <label>
        <span>{suggestion.kind === "plan" ? "Scheduled for (optional)" : "Occurred at"}</span>
        <input type="datetime-local" value={timestamp} onChange={event => setTimestamp(event.target.value)} />
      </label>
      {suggestion.payload.matchedPeople.length > 0 && (
        <fieldset>
          <legend>People</legend>
          {suggestion.payload.matchedPeople.map(person => (
            <label key={person.id} className="capture-person-option">
              <input
                type="checkbox"
                checked={personIds.includes(person.id)}
                onChange={event => setPersonIds(current =>
                  event.target.checked
                    ? [...current, person.id]
                    : current.filter(id => id !== person.id))}
              />
              <span>{person.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      {unmatchedNames.length > 0 && (
        <div className="capture-unmatched">Mentioned but not matched: {unmatchedNames.join(", ")}</div>
      )}
      {suggestion.payload.reason && <div className="capture-suggestion-reason">{suggestion.payload.reason}</div>}
      {error && <div className="capture-analysis-status error" role="alert">{error}</div>}
      <div className="capture-suggestion-actions">
        <button type="button" className="capture-secondary" disabled={busy} onClick={() => review("dismiss")}>
          Dismiss
        </button>
        <button type="button" className="capture-submit" disabled={busy || !title.trim()} onClick={() => review("accept")}>
          {busy ? "Saving…" : `Create ${suggestion.kind}`}
        </button>
      </div>
    </div>
  )
}

function toLocalDateTimeValue(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
