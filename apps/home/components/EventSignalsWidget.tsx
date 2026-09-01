import { listEventSignals } from "@life-os/domain/event-signals-list"
import { EventSignalsList } from "@life-os/ui"
import { cacheLife, unstable_cache } from "next/cache"

export default async function EventSignalsWidget({
  workspaceId,
  tz,
}: {
  workspaceId: string
  tz: string
}) {
  "use cache"
  cacheLife({ stale: 300, revalidate: 30, expire: 86400 })

  let items: Array<{
    id: string
    source: string
    title: string
    detail: string | null
    when: string | null
  }> = []
  try {
    items = process.env.NODE_ENV === "production"
      ? await getCachedEventSignals(workspaceId)
      : await loadEventSignals(workspaceId)
  } catch (error) {
    console.error("[home] event signals widget failed", error)
    return null
  }

  if (!items.length) return null

  return (
    <div className="dashboard-schedule-card" style={card}>
      <div style={{ marginBottom: "18px" }}>
        <div className="quick-capture-eyebrow">Training</div>
        <h2 style={heading}>Event signals</h2>
        <p style={subheading}>One tap to teach what counts as an event — and whether you went.</p>
      </div>
      <EventSignalsList
        initialItems={items}
        endpointFor={(id) => `/api/event-signals/${encodeURIComponent(id)}`}
        variant="light"
        tz={tz}
      />
    </div>
  )
}

async function loadEventSignals(workspaceId: string) {
  const rows = await listEventSignals({ workspaceId, limit: 8 })
  return rows.map(row => ({
    id: row.id,
    source: row.source,
    title: row.title,
    detail: row.detail,
    when: row.when,
  }))
}

function getCachedEventSignals(workspaceId: string) {
  return unstable_cache(
    async () => loadEventSignals(workspaceId),
    ["home-event-signals-v2", workspaceId],
    { revalidate: 30, tags: ["home-event-signals"] },
  )()
}

const card: React.CSSProperties = {
  background: "rgba(247, 244, 238, 0.045)",
  border: "1px solid rgba(196, 165, 116, 0.18)",
  borderRadius: "var(--radius-lg)",
  padding: "32px",
}

const heading: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "22px",
  fontWeight: 400,
  margin: "6px 0 0",
}

const subheading: React.CSSProperties = {
  margin: "8px 0 0",
  fontSize: "12px",
  color: "var(--ink-3)",
  lineHeight: 1.5,
}
