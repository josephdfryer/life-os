"use client"

import { useEffect, useRef, useState } from "react"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt?: string
  pending?: boolean
}

export default function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState("")
  const [thinking, setThinking] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch("/api/chat")
      .then(res => (res.ok ? res.json() : { messages: [] }))
      .then(data => setMessages(data.messages ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true))
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
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      const reply = res.ok ? data.reply : (data.error ?? "Something went wrong")
      setMessages(prev => [...prev, { id: `local-${Date.now()}-r`, role: "assistant", content: reply }])
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
        <span style={{ fontFamily: "var(--font-display)", fontSize: "18px", color: "var(--ink)" }}>Assistant</span>
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
        <div style={{ width: "min(100%, 720px)", margin: "0 auto", display: "flex", gap: "10px", alignItems: "flex-end" }}>
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
      </footer>
    </div>
  )
}
