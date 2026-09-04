"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { uploadFile, type UploadedFile } from "@/lib/upload"

const STAGE_LABEL = { hashing: "Hashing", authorizing: "Authorizing", uploading: "Uploading", verifying: "Verifying" } as const
const MAX_SCOPED_FILES = 10

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt?: string
  pending?: boolean
  citations?: Array<{ chunkId: string; fileId: string; filename: string; locator: unknown; exactQuote: string }>
}

type MessagePage = {
  messages?: Array<Message & { metadata?: string | null }>
  nextCursor?: string | null
  hasMore?: boolean
}

const INITIAL_MESSAGE_COUNT = 4

function decodeMessages(page: MessagePage): Message[] {
  return (page.messages ?? []).map(message => {
    try { return { ...message, ...(message.metadata ? JSON.parse(message.metadata) : {}) } } catch { return message }
  })
}

export default function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState("")
  const [thinking, setThinking] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  // Only files attached during this session are offered as scope. Scoping is a
  // narrowing of what the agent already reaches — with none selected it searches
  // the whole library — so a library-wide picker sitting above the composer was
  // permanent clutter that also had to page the entire library on every load.
  const [sessionFiles, setSessionFiles] = useState<UploadedFile[]>([])
  const [fileIds, setFileIds] = useState<string[]>([])
  const [uploadStatus, setUploadStatus] = useState("")
  const messageListRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const attachRef = useRef<HTMLInputElement>(null)
  const initialPositionedRef = useRef(false)
  const previousScrollHeightRef = useRef<number | null>(null)
  const scrollToLatestRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/chat?limit=${INITIAL_MESSAGE_COUNT}`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : { messages: [] }))
      .then((data: MessagePage) => {
        setMessages(decodeMessages(data))
        setNextCursor(data.hasMore ? data.nextCursor ?? null : null)
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
    return () => controller.abort()
  }, [])

  useLayoutEffect(() => {
    const list = messageListRef.current
    if (!list || !loaded) return

    if (previousScrollHeightRef.current !== null) {
      list.scrollTop += list.scrollHeight - previousScrollHeightRef.current
      previousScrollHeightRef.current = null
      return
    }

    if (!initialPositionedRef.current) {
      list.scrollTop = list.scrollHeight
      initialPositionedRef.current = true
      return
    }

    if (scrollToLatestRef.current) {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" })
      scrollToLatestRef.current = false
    }
  }, [loaded, messages, thinking])

  const loadEarlier = useCallback(async () => {
    const list = messageListRef.current
    if (!nextCursor || loadingEarlier || !list) return
    setLoadingEarlier(true)
    previousScrollHeightRef.current = list.scrollHeight
    try {
      const response = await fetch(`/api/chat?limit=${INITIAL_MESSAGE_COUNT}&cursor=${encodeURIComponent(nextCursor)}`)
      if (!response.ok) throw new Error("Could not load earlier messages")
      const data = await response.json() as MessagePage
      const earlier = decodeMessages(data)
      if (earlier.length === 0) previousScrollHeightRef.current = null
      setMessages(current => [...earlier, ...current])
      setNextCursor(data.hasMore ? data.nextCursor ?? null : null)
    } catch {
      previousScrollHeightRef.current = null
    } finally {
      setLoadingEarlier(false)
    }
  }, [loadingEarlier, nextCursor])

  useEffect(() => {
    const list = messageListRef.current
    if (!list) return
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && list.scrollTop <= 0) void loadEarlier()
    }
    list.addEventListener("wheel", handleWheel, { passive: true })
    return () => list.removeEventListener("wheel", handleWheel)
  }, [loadEarlier])

  async function attach(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.target.files ?? [])]
    if (attachRef.current) attachRef.current.value = ""
    for (const file of chosen) {
      try {
        const uploaded = await uploadFile(file, {
          onProgress: (stage, filename) => setUploadStatus(`${STAGE_LABEL[stage]} ${filename}…`),
        })
        // Attaching is the intent to scope — select it rather than making the
        // user upload and then pick the same file again.
        setSessionFiles(current => current.some(f => f.id === uploaded.id) ? current : [...current, uploaded])
        setFileIds(current => current.includes(uploaded.id) || current.length >= MAX_SCOPED_FILES ? current : [...current, uploaded.id])
        setUploadStatus(`${uploaded.filename} attached — still processing, so extraction may lag a moment.`)
      } catch (error) {
        setUploadStatus(error instanceof Error ? error.message : "Upload failed")
        return
      }
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || thinking) return
    setDraft("")
    setThinking(true)
    scrollToLatestRef.current = true
    setMessages(prev => [...prev, { id: `local-${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() }])
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, fileIds }),
      })
      const data = await res.json()
      const reply = res.ok ? data.reply : (data.error ?? "Something went wrong")
      scrollToLatestRef.current = true
      setMessages(prev => [...prev, { id: `local-${Date.now()}-r`, role: "assistant", content: reply, citations: data.citations ?? [], createdAt: new Date().toISOString() }])
    } catch {
      scrollToLatestRef.current = true
      setMessages(prev => [...prev, { id: `local-${Date.now()}-e`, role: "assistant", content: "Network error — try again.", createdAt: new Date().toISOString() }])
    } finally {
      setThinking(false)
      inputRef.current?.focus()
    }
  }

  function formatTimestamp(iso?: string) {
    if (!iso) return ""
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ""
    const now = new Date()
    const sameDay = date.toDateString() === now.toDateString()
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    if (sameDay) return time
    const day = date.toLocaleDateString([], { month: "short", day: "numeric" })
    return `${day} · ${time}`
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <header className="assistant-header" style={{
        padding: "14px 24px", borderBottom: "1px solid var(--border-subtle)",
        background: "var(--surface)", display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap", rowGap: "6px",
      }}>
        <a href="/" style={{ fontFamily: "var(--font-display)", fontSize: "18px", color: "var(--ink)", textDecoration: "none" }}>Assistant</a>
        <nav style={{ display: "flex", gap: "6px", marginLeft: "8px" }}>
          <a href="/" style={{ padding: "5px 12px", borderRadius: "var(--radius-pill)", background: "var(--cognac-soft)", color: "var(--cognac-deep)", textDecoration: "none", fontSize: "12px" }}>Chat</a>
          <a href="/files" style={{ padding: "5px 12px", borderRadius: "var(--radius-pill)", color: "var(--ink-3)", textDecoration: "none", fontSize: "12px" }}>Files</a>
        </nav>
        <span className="assistant-header-subtitle" style={{ fontSize: "11px", color: "var(--ink-4)", fontStyle: "italic" }}>
          same brain as WhatsApp — people, schedule, notes, money
        </span>
        <style>{`
          @media (max-width: 560px) {
            .assistant-header-subtitle { display: none; }
          }
        `}</style>
      </header>

      <main
        ref={messageListRef}
        onScroll={event => {
          if (event.currentTarget.scrollTop <= 32) void loadEarlier()
        }}
        style={{ flex: 1, overflowY: "auto", padding: "24px 0", overscrollBehavior: "contain" }}
      >
        <div style={{ width: "min(100%, 720px)", margin: "0 auto", padding: "0 24px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {nextCursor && (
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={loadingEarlier}
              style={{ alignSelf: "center", border: 0, background: "transparent", color: "var(--ink-3)", cursor: "pointer", font: "inherit", fontSize: "11px", padding: "2px 8px" }}
            >
              {loadingEarlier ? "Loading earlier messages…" : "Scroll up for earlier messages"}
            </button>
          )}
          {loaded && messages.length === 0 && (
            <div style={{ textAlign: "center", padding: "80px 24px", color: "var(--ink-3)" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "20px", color: "var(--ink-2)", marginBottom: "8px" }}>
                What do you want to know?
              </div>
              <div style={{ fontSize: "12px", lineHeight: 1.8 }}>
                &ldquo;What&rsquo;s my day look like?&rdquo; · &ldquo;How much have I spent at Foxtail?&rdquo;<br />
                &ldquo;When did I last talk to Manav?&rdquo; · &ldquo;note: idea for the places map&rdquo;
              </div>
            </div>
          )}
          {messages.map(message => (
            <div
              key={message.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignSelf: message.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "min(85%, 100%)",
                minWidth: 0,
                alignItems: message.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: message.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  background: message.role === "user" ? "var(--ink)" : "var(--surface)",
                  border: message.role === "user" ? "none" : "1px solid var(--border)",
                  color: message.role === "user" ? "var(--bg)" : "var(--ink)",
                  fontSize: "13.5px",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  minWidth: 0,
                  maxWidth: "100%",
                }}
              >
                {message.content}
                {!!message.citations?.length && <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--border-subtle)", fontSize: "11px", color: "var(--ink-3)" }}>
                  {message.citations.map(citation => <a key={citation.chunkId} href={`/files/${citation.fileId}?chunkId=${citation.chunkId}#${citation.chunkId}`} style={{ display: "block", color: "var(--cognac-deep)" }}>{citation.filename} · {citation.chunkId}</a>)}
                </div>}
              </div>
              {!!formatTimestamp(message.createdAt) && (
                <span style={{ fontSize: "10.5px", color: "var(--ink-4)", padding: "3px 4px 0" }}>
                  {formatTimestamp(message.createdAt)}
                </span>
              )}
            </div>
          ))}
          {thinking && (
            <div style={{
              alignSelf: "flex-start", padding: "10px 16px", borderRadius: "14px 14px 14px 4px",
              background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-4)", fontSize: "13px",
            }}>
              <span className="assistant-thinking">thinking</span>
              <style>{`
                .assistant-thinking::after { content: ""; animation: assistant-dots 1.4s steps(4, end) infinite; }
                @keyframes assistant-dots { 0% { content: "" } 25% { content: "." } 50% { content: ".." } 75% { content: "..." } }
              `}</style>
            </div>
          )}
        </div>
      </main>

      <footer style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface)", padding: "14px 24px 18px" }}>
        <div style={{ width: "min(100%, 720px)", margin: "0 auto" }}>
          {!!sessionFiles.length && <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "8px", overflowX: "auto" }}>
            <span style={{ color: "var(--ink-4)", fontSize: "11px", flex: "0 0 auto" }}>Scope to</span>
            {sessionFiles.map(file => {
              const selected = fileIds.includes(file.id)
              return <button
                key={file.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setFileIds(ids => selected ? ids.filter(id => id !== file.id) : ids.length < MAX_SCOPED_FILES ? [...ids, file.id] : ids)}
                title={selected ? `${file.filename} — tap to stop scoping to it` : `${file.filename} — tap to scope this turn to it`}
                style={{ border: `1px solid ${selected ? "var(--cognac)" : "var(--border)"}`, background: selected ? "var(--cognac-soft)" : "transparent", color: selected ? "var(--cognac-deep)" : "var(--ink-3)", borderRadius: "var(--radius-pill)", padding: "4px 9px", fontSize: "10px", whiteSpace: "nowrap", flex: "0 0 auto" }}
              >{file.filename}</button>
            })}
          </div>}
          {uploadStatus && <div style={{ color: "var(--ink-3)", fontSize: "11px", marginBottom: "8px" }}>{uploadStatus}</div>}
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
          <input ref={attachRef} hidden type="file" multiple onChange={attach} />
          <button
            type="button"
            onClick={() => attachRef.current?.click()}
            disabled={thinking}
            aria-label="Attach a photo or file"
            title="Attach a photo or file"
            style={{
              flex: "0 0 auto", width: 42, height: 42, borderRadius: "12px",
              border: "1px solid var(--border)", background: "transparent",
              color: "var(--ink-3)", font: "inherit", fontSize: "17px",
              cursor: thinking ? "default" : "pointer", lineHeight: 1,
            }}
          >
            +
          </button>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Message your LifeOS…"
            rows={Math.min(5, Math.max(1, draft.split("\n").length))}
            style={{
              flex: 1, resize: "none", border: "1px solid var(--border)", borderRadius: "12px",
              padding: "11px 14px", background: "var(--bg)", color: "var(--ink)",
              font: "inherit", fontSize: "13.5px", lineHeight: 1.5, outline: "none",
            }}
          />
          <button
            onClick={send}
            disabled={!draft.trim() || thinking}
            style={{
              flex: "0 0 auto", height: 42, padding: "0 20px", borderRadius: "12px", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: draft.trim() && !thinking ? "var(--cognac)" : "var(--border)",
              color: draft.trim() && !thinking ? "#fff" : "var(--ink-4)",
              font: "inherit", fontSize: "13px", fontWeight: 500, lineHeight: 1,
              cursor: draft.trim() && !thinking ? "pointer" : "default",
            }}
          >
            Send
          </button>
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--ink-4)", fontSize: "10px", textAlign: "center" }}>
            Workspace administrators can review this conversation.
          </p>
        </div>
      </footer>
    </div>
  )
}
