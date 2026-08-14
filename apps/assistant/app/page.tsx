"use client"

import { useEffect, useMemo, useRef, useState } from "react"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt?: string
  pending?: boolean
  citations?: Array<{ chunkId: string; fileId: string; filename: string; locator: unknown; exactQuote: string }>
}

type LibraryFile = { id: string; filename: string; processingState: string }

export default function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState("")
  const [thinking, setThinking] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [fileIds, setFileIds] = useState<string[]>([])
  const [fileQuery, setFileQuery] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const visibleFiles = useMemo(() => {
    const query = fileQuery.trim().toLowerCase()
    const selected = new Set(fileIds)
    return files.filter(file => file.filename.toLowerCase().includes(query)).sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id))).slice(0, 20)
  }, [fileIds, fileQuery, files])

  useEffect(() => {
    fetch("/api/chat")
      .then(res => (res.ok ? res.json() : { messages: [] }))
      .then(data => setMessages((data.messages ?? []).map((message: Message & { metadata?: string | null }) => {
        try { return { ...message, ...(message.metadata ? JSON.parse(message.metadata) : {}) } } catch { return message }
      })))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    async function loadLibrary() {
      const loaded: LibraryFile[] = []
      let cursor: string | null = null
      do {
        const response: Response = await fetch(`/api/files?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal: controller.signal })
        if (!response.ok) break
        const page = await response.json() as { files?: LibraryFile[]; nextCursor?: string | null }
        loaded.push(...(page.files ?? []))
        cursor = page.nextCursor ?? null
      } while (cursor && !controller.signal.aborted)
      if (!controller.signal.aborted) setFiles(loaded)
    }
    loadLibrary().catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 2 ? "smooth" : "auto" })
  }, [messages, thinking])

  async function send() {
    const text = draft.trim()
    if (!text || thinking) return
    setDraft("")
    setThinking(true)
    setMessages(prev => [...prev, { id: `local-${Date.now()}`, role: "user", content: text }])
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, fileIds }),
      })
      const data = await res.json()
      const reply = res.ok ? data.reply : (data.error ?? "Something went wrong")
      setMessages(prev => [...prev, { id: `local-${Date.now()}-r`, role: "assistant", content: reply, citations: data.citations ?? [] }])
    } catch {
      setMessages(prev => [...prev, { id: `local-${Date.now()}-e`, role: "assistant", content: "Network error — try again." }])
    } finally {
      setThinking(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <header style={{
        padding: "14px 24px", borderBottom: "1px solid var(--border-subtle)",
        background: "var(--surface)", display: "flex", alignItems: "baseline", gap: "12px",
      }}>
        <a href="/" style={{ fontFamily: "var(--font-display)", fontSize: "18px", color: "var(--ink)", textDecoration: "none" }}>Assistant</a>
        <nav style={{ display: "flex", gap: "6px", marginLeft: "8px" }}>
          <a href="/" style={{ padding: "5px 12px", borderRadius: "var(--radius-pill)", background: "var(--cognac-soft)", color: "var(--cognac-deep)", textDecoration: "none", fontSize: "12px" }}>Chat</a>
          <a href="/files" style={{ padding: "5px 12px", borderRadius: "var(--radius-pill)", color: "var(--ink-3)", textDecoration: "none", fontSize: "12px" }}>Files</a>
        </nav>
        <span style={{ fontSize: "11px", color: "var(--ink-4)", fontStyle: "italic" }}>
          same brain as WhatsApp — people, schedule, notes, money
        </span>
      </header>

      <main style={{ flex: 1, overflowY: "auto", padding: "24px 0" }}>
        <div style={{ width: "min(100%, 720px)", margin: "0 auto", padding: "0 24px", display: "flex", flexDirection: "column", gap: "14px" }}>
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
                alignSelf: message.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius: message.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                background: message.role === "user" ? "var(--ink)" : "var(--surface)",
                border: message.role === "user" ? "none" : "1px solid var(--border)",
                color: message.role === "user" ? "var(--bg)" : "var(--ink)",
                fontSize: "13.5px",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {message.content}
              {!!message.citations?.length && <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--border-subtle)", fontSize: "11px", color: "var(--ink-3)" }}>
                {message.citations.map(citation => <a key={citation.chunkId} href={`/files/${citation.fileId}?chunkId=${citation.chunkId}#${citation.chunkId}`} style={{ display: "block", color: "var(--cognac-deep)" }}>{citation.filename} · {citation.chunkId}</a>)}
              </div>}
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
          <div ref={bottomRef} />
        </div>
      </main>

      <footer style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface)", padding: "14px 24px 18px" }}>
        <div style={{ width: "min(100%, 720px)", margin: "0 auto" }}>
          {!!files.length && <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "8px", overflowX: "auto" }}>
            <span style={{ color: "var(--ink-4)", fontSize: "11px", flex: "0 0 auto" }}>Scope to files</span>
            <label style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }} htmlFor="file-scope-search">Find a file</label>
            <input id="file-scope-search" value={fileQuery} onChange={event => setFileQuery(event.target.value)} placeholder="Find a file…" style={{ width: 120, border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: "4px 9px", background: "transparent", color: "var(--ink-2)", font: "inherit", fontSize: 10 }} />
            {visibleFiles.map(file => {
              const selected = fileIds.includes(file.id)
              return <button key={file.id} type="button" onClick={() => setFileIds(ids => selected ? ids.filter(id => id !== file.id) : ids.length < 10 ? [...ids, file.id] : ids)} style={{ border: `1px solid ${selected ? "var(--cognac)" : "var(--border)"}`, background: selected ? "var(--cognac-soft)" : "transparent", color: selected ? "var(--cognac-deep)" : "var(--ink-3)", borderRadius: "var(--radius-pill)", padding: "4px 9px", fontSize: "10px", whiteSpace: "nowrap" }}>{file.filename}</button>
            })}
          </div>}
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
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
            placeholder="Message your Life OS…"
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
              padding: "11px 20px", borderRadius: "12px", border: "none",
              background: draft.trim() && !thinking ? "var(--cognac)" : "var(--border)",
              color: draft.trim() && !thinking ? "#fff" : "var(--ink-4)",
              font: "inherit", fontSize: "13px", fontWeight: 500,
              cursor: draft.trim() && !thinking ? "pointer" : "default",
            }}
          >
            Send
          </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
