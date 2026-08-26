"use client"

import { useEffect, useRef, useState } from "react"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  pending?: boolean
}

// Same brain as the standalone assistant.lacollecteur.com chat and WhatsApp —
// this panel just talks to it through Home's own /api/assistant proxy
// instead of duplicating the agent. See apps/home/app/api/assistant/[...path]/route.ts.
export default function AssistantPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState("")
  const [thinking, setThinking] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch("/api/assistant/chat")
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
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      const reply = res.ok ? data.reply : (data.error?.message ?? data.error ?? "Something went wrong")
      setMessages(prev => [...prev, { id: `local-${Date.now()}-r`, role: "assistant", content: reply }])
    } catch {
      setMessages(prev => [...prev, { id: `local-${Date.now()}-e`, role: "assistant", content: "Network error — try again." }])
    } finally {
      setThinking(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div style={card}>
      <h2 style={{ ...heading, marginBottom: "16px" }}>Assistant</h2>

      <div style={{ maxHeight: "360px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
        {loaded && messages.length === 0 && (
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--ink-3)", fontSize: "13px" }}>
            &ldquo;What&rsquo;s my day look like?&rdquo; · &ldquo;note: idea for the places map&rdquo; · &ldquo;who have I not talked to in a while?&rdquo;
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
              background: message.role === "user" ? "var(--camel)" : "rgba(247, 244, 238, 0.06)",
              color: message.role === "user" ? "#1a2a35" : "var(--ink)",
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
          <div style={{ alignSelf: "flex-start", color: "var(--ink-3)", fontSize: "13px" }}>thinking…</div>
        )}
        <div ref={bottomRef} />
      </div>

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
          placeholder="Message your LifeOS…"
          rows={Math.min(4, Math.max(1, draft.split("\n").length))}
          className="assistant-composer-input"
          style={{
            flex: 1,
            resize: "none",
            border: "1px solid rgba(196, 165, 116, 0.24)",
            borderRadius: "12px",
            padding: "11px 14px",
            background: "rgba(247, 244, 238, 0.03)",
            color: "var(--ink)",
            font: "inherit",
            fontSize: "13.5px",
            lineHeight: 1.5,
            outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={!draft.trim() || thinking}
          style={{
            padding: "11px 20px",
            borderRadius: "12px",
            border: "none",
            background: draft.trim() && !thinking ? "var(--camel)" : "rgba(196, 165, 116, 0.14)",
            color: draft.trim() && !thinking ? "#1a2a35" : "var(--ink-3)",
            font: "inherit",
            fontSize: "13px",
            fontWeight: 500,
            cursor: draft.trim() && !thinking ? "pointer" : "default",
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}

const card: React.CSSProperties = {
  background: "rgba(247, 244, 238, 0.045)",
  border: "1px solid rgba(196, 165, 116, 0.18)",
  borderRadius: "var(--radius-lg)",
  padding: "32px",
}

const heading: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "1.4rem",
  fontWeight: 400,
  margin: 0,
}
