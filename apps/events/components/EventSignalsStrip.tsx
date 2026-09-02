import { listEventSignals } from "@life-os/domain/event-signals-list"
import { EventSignalsList } from "@life-os/ui"

export default async function EventSignalsStrip({
  workspaceId,
  tz,
}: {
  workspaceId: string
  tz: string
}) {
  let items: Awaited<ReturnType<typeof listEventSignals>> = []
  try {
    items = await listEventSignals({ workspaceId, limit: 6 })
  } catch (error) {
    console.error("[events] event signals strip failed", error)
    return null
  }

  if (!items.length) return null

  return (
    <section style={{ marginBottom: "24px" }}>
      <div style={{ marginBottom: "14px" }}>
        <div style={eyebrow}>Training</div>
        <h2 style={title}>Event signals</h2>
        <p style={copy}>Quick feedback on things that might be events — from messages, notes, and calendar.</p>
      </div>
      <EventSignalsList
        initialItems={items.map(row => ({
          id: row.id,
          source: row.source,
          title: row.title,
          detail: row.detail,
          when: row.when,
        }))}
        endpointPrefix="/api/event-signals"
        variant="dark"
        tz={tz}
      />
    </section>
  )
}

const eyebrow: React.CSSProperties = {
  fontSize: "10px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--camel, #c4a574)",
}

const title: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "20px",
  fontWeight: 400,
  margin: "6px 0 0",
  color: "var(--ink-1, #f7f4ee)",
}

const copy: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: "12px",
  color: "var(--ink-3, #a69c90)",
}
