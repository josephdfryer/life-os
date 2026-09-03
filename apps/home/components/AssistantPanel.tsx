"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  pending?: boolean
}

type MessagePage = {
  messages?: Message[]
  nextCursor?: string | null
  hasMore?: boolean
}

const INITIAL_MESSAGE_COUNT = 4

// Same brain as the standalone assistant.lacollecteur.com chat and WhatsApp —
// this panel just talks to it through Home's own /api/assistant proxy
// instead of duplicating the agent. See apps/home/app/api/assistant/[...path]/route.ts.
export default function AssistantPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState("")
  const [thinking, setThinking] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const messageListRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const initialPositionedRef = useRef(false)
  const previousScrollHeightRef = useRef<number | null>(null)
  const scrollToLatestRef = useRef(false)

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

  useEffect(() => {
    if (window.location.hash !== "#assistant") return
    const panel = document.getElementById("assistant")
    if (!panel) return
    window.setTimeout(() => {
      panel.scrollIntoView({ behavior: "smooth", block: "start" })
      inputRef.current?.focus()
    }, 120)
  }, [loaded])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/assistant/chat?limit=${INITIAL_MESSAGE_COUNT}`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : { messages: [] }))
      .then((data: MessagePage) => {
        setMessages(data.messages ?? [])
        setNextCursor(data.hasMore ? data.nextCursor ?? null : null)
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
    return () => controller.abort()
  }, [])

  const loadEarlier = useCallback(async () => {
    const list = messageListRef.current
    if (!nextCursor || loadingEarlier || !list) return
    setLoadingEarlier(true)
    previousScrollHeightRef.current = list.scrollHeight
    try {
      const response = await fetch(`/api/assistant/chat?limit=${INITIAL_MESSAGE_COUNT}&cursor=${encodeURIComponent(nextCursor)}`)
      if (!response.ok) throw new Error("Could not load earlier messages")
      const data = await response.json() as MessagePage
      const earlier = data.messages ?? []
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

  async function send() {
    const text = draft.trim()
    if (!text || thinking) return
    setDraft("")
    setThinking(true)
    scrollToLatestRef.current = true
    setMessages(prev => [...prev, { id: `local-${Date.now()}`, role: "user", content: text }])
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      const reply = res.ok ? data.reply : (data.error?.message ?? data.error ?? "Something went wrong")
      scrollToLatestRef.current = true
      setMessages(prev => [...prev, { id: `local-${Date.now()}-r`, role: "assistant", content: reply }])
    } catch {
      scrollToLatestRef.current = true
      setMessages(prev => [...prev, { id: `local-${Date.now()}-e`, role: "assistant", content: "Network error — try again." }])
    } finally {
      setThinking(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div id="assistant" className="dashboard-assistant-card" style={card}>
      <h2 style={{ ...heading, marginBottom: "16px" }}>Assistant</h2>

      <div
        ref={messageListRef}
        className="assistant-message-list"
        onScroll={event => {
          if (event.currentTarget.scrollTop <= 24) void loadEarlier()
        }}
        style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px", overscrollBehavior: "contain" }}
      >
        {nextCursor && (
          <button
            type="button"
            onClick={() => void loadEarlier()}
            disabled={loadingEarlier}
            style={earlierButton}
          >
            {loadingEarlier ? "Loading earlier messages…" : "Scroll up for earlier messages"}
          </button>
        )}
        {loaded && messages.length === 0 && (
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--ink-3)", fontSize: "13px" }}>
            &ldquo;What&rsquo;s my day look like?&rdquo; · &ldquo;note: idea for the places map&rdquo; · &ldquo;who have I not talked to in a while?&rdquo;
          </div>
        )}
        {messages.map(message => (
          <div
            key={message.id}
            className={`assistant-message assistant-message--${message.role}`}
            style={{
              alignSelf: message.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "min(85%, 100%)",
              minWidth: 0,
              padding: "10px 14px",
              borderRadius: message.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              background: message.role === "user" ? "var(--camel)" : "rgba(247, 244, 238, 0.06)",
              color: message.role === "user" ? "#1a2a35" : "var(--ink)",
              fontSize: "13.5px",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {message.content}
          </div>
        ))}
        {thinking && (
          <div style={{ alignSelf: "flex-start", color: "var(--ink-3)", fontSize: "13px" }}>thinking…</div>
        )}
      </div>

      <div className="assistant-composer-row">
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
          className="assistant-send-button"
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
}

const heading: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "1.4rem",
  fontWeight: 400,
  margin: 0,
}

const earlierButton: React.CSSProperties = {
  alignSelf: "center",
  border: 0,
  background: "transparent",
  color: "var(--ink-3)",
  cursor: "pointer",
  font: "inherit",
  fontSize: "11px",
  padding: "2px 8px",
}
