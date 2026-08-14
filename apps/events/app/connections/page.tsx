import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { getWorkspaceId } from "@/lib/workspace"
import { granolaStatus } from "@/server/domain/granola"

export const dynamic = "force-dynamic"

export default async function ConnectionsPage() {
  const session = await auth()
  if (!session?.user?.email) redirect("/login")

  const workspaceId = await getWorkspaceId(session.user.email)
  const [granola, calendars] = await Promise.all([
    granolaStatus(workspaceId),
    db.calendarConnection.findMany({
      where: { workspaceId, provider: "google" },
      select: { status: true, lastSyncedAt: true, calendarSummary: true, _count: { select: { eventLinks: true } } },
      orderBy: { calendarSummary: "asc" },
    }),
  ])

  const activeCalendars = calendars.filter(connection => connection.status === "active")
  const calendarEvents = activeCalendars.reduce((total, connection) => total + connection._count.eventLinks, 0)
  const calendarLastSync = latestDate(activeCalendars.map(connection => connection.lastSyncedAt))

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ marginBottom: 28 }}>
        <p style={eyebrowStyle}>Events settings</p>
        <h1 style={titleStyle}>Connections</h1>
        <p style={introStyle}>Choose the services that bring calendars, meetings, summaries, and transcripts into the shared Event graph.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <ConnectionCard
          name="Google Calendar"
          description="Import selected calendars as Events and match attendees to People by exact email."
          status={activeCalendars.length ? `${activeCalendars.length} ${activeCalendars.length === 1 ? "calendar" : "calendars"} connected` : "Not connected"}
          detail={activeCalendars.length ? `${calendarEvents} imported events${calendarLastSync ? ` · Last sync ${formatDate(calendarLastSync)}` : ""}` : "Connect an account and choose which calendars Life OS may read."}
          href="/settings/calendar"
          connected={activeCalendars.length > 0}
        />
        <ConnectionCard
          name="Granola"
          description="Import meeting summaries and transcripts into Events, People, and Groups."
          status={granola.connected ? "Connected" : "Not connected"}
          detail={granola.connected
            ? `${granola.metadata.importedCount ?? 0} meetings imported${granola.lastSyncedAt ? ` · Last sync ${formatDate(granola.lastSyncedAt)}` : ""}`
            : "Connect a Granola workspace to begin the daily meeting sync."}
          href="/settings/granola"
          connected={granola.connected}
        />
      </div>
    </div>
  )
}

function ConnectionCard({ name, description, status, detail, href, connected }: {
  name: string
  description: string
  status: string
  detail: string
  href: string
  connected: boolean
}) {
  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 500 }}>{name}</h2>
        <span style={{ ...statusStyle, background: connected ? "var(--cognac-soft)" : "var(--surface-2)", color: connected ? "var(--cognac-deep)" : "var(--ink-3)" }}>{status}</span>
      </div>
      <p style={{ margin: "14px 0 6px", color: "var(--ink-2)", fontSize: 13 }}>{description}</p>
      <p style={{ margin: 0, color: "var(--ink-4)", fontSize: 11, minHeight: 34 }}>{detail}</p>
      <Link href={href} style={manageLinkStyle}>Manage connection →</Link>
    </section>
  )
}

function latestDate(values: Array<Date | null>) {
  return values.reduce<Date | null>((latest, value) => !value || (latest && latest >= value) ? latest : value, null)
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(value)
}

const eyebrowStyle = { margin: "0 0 5px", color: "var(--ink-4)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" as const }
const titleStyle = { margin: 0, fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 500, letterSpacing: "-0.02em" }
const introStyle = { maxWidth: 650, margin: "7px 0 0", color: "var(--ink-3)", fontSize: 13 }
const cardStyle = { padding: 22, borderRadius: "var(--radius)", background: "var(--surface)", boxShadow: "var(--shadow-sm)", border: "1px solid var(--border-subtle)" }
const statusStyle = { flexShrink: 0, padding: "4px 8px", borderRadius: "var(--radius-pill)", fontSize: 10, fontWeight: 500 }
const manageLinkStyle = { display: "inline-flex", marginTop: 20, color: "var(--cognac-deep)", fontSize: 12, fontWeight: 500, textDecoration: "none" }
