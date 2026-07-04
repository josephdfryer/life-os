import { notFound, redirect } from "next/navigation"
import { lifeOsAppUrl } from "@life-os/auth"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { getWorkspaceId } from "@/lib/workspace"
import { formatEventTime, formatEventType, parseEventMetadata } from "@/lib/events"
import { computePlanTension, formatWhen } from "@/lib/plan-tension"
import LogInteractionForm from "@/components/events/LogInteractionForm"

export const dynamic = "force-dynamic"

function personName(first: string, last: string | null) {
  return `${first} ${last ?? ""}`.trim()
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.email) redirect("/login")
  const workspaceId = await getWorkspaceId(session.user.email)
  const { id } = await params
  const personsUrl = lifeOsAppUrl("persons", "http://localhost:3000")

  const event = await db.event.findFirst({
    where: { id, workspaceId },
    include: {
      place: true,
      sourcePlan: {
        select: {
          id: true,
          text: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
        },
      },
      parentEvent: { select: { id: true, name: true, start: true } },
      childEvents: { select: { id: true, name: true, start: true }, orderBy: { start: "asc" } },
      interactions: {
        include: { person: { select: { id: true, first: true, last: true } } },
        orderBy: { timestamp: "asc" },
      },
      calendarLinks: { select: { externalEventId: true, provider: true } },
    },
  })

  if (!event) notFound()

  const nearbyPlans =
    event.sourcePlanId === null
      ? await db.plan.findMany({
          where: {
            workspaceId,
            scheduledStart: {
              gte: new Date(event.start.getTime() - 2 * 60 * 60 * 1000),
              lte: new Date(event.start.getTime() + 2 * 60 * 60 * 1000),
            },
          },
          select: { id: true, text: true, scheduledStart: true, status: true },
          orderBy: { scheduledStart: "asc" },
          take: 3,
        })
      : []

  const tension = computePlanTension(event, event.sourcePlan)
  const { date, range } = formatEventTime(new Date(event.start), event.end ? new Date(event.end) : null)
  const metadata = parseEventMetadata(event.metadata)
  const htmlLink = typeof metadata?.htmlLink === "string" ? metadata.htmlLink : null

  const row: React.CSSProperties = {
    display: "flex",
    gap: "32px",
    padding: "10px 0",
    borderBottom: "1px solid var(--border)",
  }
  const keyStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "var(--ink-4)",
    width: "140px",
    flexShrink: 0,
  }
  const valStyle: React.CSSProperties = { fontSize: "13px", color: "var(--ink)", flex: 1 }
  const sectionLabel: React.CSSProperties = {
    fontFamily: "var(--font-dm-mono)",
    fontSize: "10px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--ink-4)",
    marginBottom: "12px",
  }

  const tensionColors = {
    fulfilled: { border: "#22c55e", bg: "rgba(34,197,94,0.08)", text: "#86efac" },
    drift: { border: "#f59e0b", bg: "rgba(245,158,11,0.1)", text: "#fbbf24" },
    none: { border: "var(--border)", bg: "var(--surface)", text: "var(--ink-3)" },
    unlinked: { border: "var(--border)", bg: "var(--surface)", text: "var(--ink-3)" },
  } as const
  const tensionStyle = tensionColors[tension.kind === "none" ? "none" : tension.kind]

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ marginBottom: "32px" }}>
        <a href="/events" style={{ fontSize: "12px", color: "var(--ink-3)", textDecoration: "none" }}>
          ← Timeline
        </a>
      </div>

      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: "10px",
              color: "var(--accent)",
              background: "var(--accent-soft)",
              padding: "4px 10px",
              borderRadius: "999px",
            }}
          >
            {formatEventType(event.type)}
          </span>
          <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "11px", color: "var(--ink-4)" }}>
            {date} · {range}
          </span>
        </div>
        <h1
          style={{
            fontFamily: "var(--font-playfair)",
            fontSize: "28px",
            fontWeight: 600,
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          {event.name}
        </h1>
      </div>

      <div
        style={{
          marginBottom: "32px",
          border: `1px solid ${tensionStyle.border}`,
          background: tensionStyle.bg,
          borderRadius: "14px",
          padding: "16px 18px",
        }}
      >
        <div style={{ fontSize: "12px", fontWeight: 600, color: tensionStyle.text, marginBottom: "6px" }}>
          {tension.headline}
        </div>
        <div style={{ fontSize: "12px", color: "var(--ink-2)", lineHeight: 1.5 }}>{tension.detail}</div>
        {event.sourcePlan?.scheduledStart && (
          <div style={{ fontSize: "11px", color: "var(--ink-4)", marginTop: "10px" }}>
            Predicted: {formatWhen(new Date(event.sourcePlan.scheduledStart))} · Actual: {formatWhen(new Date(event.start))}
          </div>
        )}
        {nearbyPlans.length > 0 && (
          <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--ink-3)" }}>
            Nearby plans without a link:
            <ul style={{ margin: "8px 0 0", paddingLeft: "18px" }}>
              {nearbyPlans.map((plan) => (
                <li key={plan.id}>
                  {plan.text}
                  {plan.scheduledStart ? ` · ${formatWhen(new Date(plan.scheduledStart))}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div style={{ marginBottom: "40px" }}>
        <div style={sectionLabel}>Event</div>
        {event.place && (
          <div style={row}>
            <span style={keyStyle}>Place</span>
            <span style={valStyle}>{event.place.name}</span>
          </div>
        )}
        {event.parentEvent && (
          <div style={row}>
            <span style={keyStyle}>Part of</span>
            <span style={valStyle}>
              <a href={`/events/${event.parentEvent.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
                {event.parentEvent.name}
              </a>
            </span>
          </div>
        )}
        {htmlLink && (
          <div style={row}>
            <span style={keyStyle}>Source</span>
            <span style={valStyle}>
              <a href={htmlLink} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>
                Open in calendar
              </a>
            </span>
          </div>
        )}
        {event.notes && (
          <div style={row}>
            <span style={keyStyle}>Notes</span>
            <span style={{ ...valStyle, whiteSpace: "pre-wrap" }}>{event.notes}</span>
          </div>
        )}
        {event.transcript && (
          <div style={row}>
            <span style={keyStyle}>Transcript</span>
            <span style={{ ...valStyle, whiteSpace: "pre-wrap", fontSize: "12px", color: "var(--ink-2)" }}>
              {event.transcript}
            </span>
          </div>
        )}
      </div>

      {event.childEvents.length > 0 && (
        <div style={{ marginBottom: "40px" }}>
          <div style={sectionLabel}>Contained events</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {event.childEvents.map((child) => (
              <a
                key={child.id}
                href={`/events/${child.id}`}
                style={{
                  padding: "12px 14px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: 500 }}>{child.name}</div>
                <div style={{ fontSize: "11px", color: "var(--ink-4)", marginTop: "4px" }}>
                  {new Date(child.start).toLocaleString()}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: "40px" }}>
        <div style={sectionLabel}>Log participation</div>
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "14px",
            padding: "18px",
          }}
        >
          <LogInteractionForm
            eventId={event.id}
            eventStart={event.start.toISOString()}
            defaultType={event.type === "calendar" ? "meeting" : event.type}
          />
        </div>
      </div>

      <div>
        <div style={sectionLabel}>Participants (interactions)</div>
        <p style={{ fontSize: "11px", color: "var(--ink-4)", margin: "0 0 16px", lineHeight: 1.5 }}>
          Shared event data lives here once. Emotional weight and personal outcomes live on each person&apos;s interaction.
        </p>

        {event.interactions.length === 0 ? (
          <div
            style={{
              padding: "24px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              fontSize: "12px",
              color: "var(--ink-3)",
            }}
          >
            No interactions linked yet. Use the form above or log from{" "}
            <a href={personsUrl} style={{ color: "var(--accent)" }}>
              Persons
            </a>
            .
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {event.interactions.map((interaction) => (
              <div
                key={interaction.id}
                style={{
                  padding: "14px 16px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "6px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 500 }}>
                    {interaction.person ? (
                      <a
                        href={`${personsUrl}/people/${interaction.person.id}`}
                        style={{ color: "var(--ink)", textDecoration: "none" }}
                      >
                        {personName(interaction.person.first, interaction.person.last)}
                      </a>
                    ) : (
                      "—"
                    )}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>{formatEventType(interaction.type)}</span>
                </div>
                {(interaction.emotionalWeight || interaction.outcome) && (
                  <div style={{ fontSize: "11px", color: "var(--ink-3)", marginBottom: "6px" }}>
                    {[interaction.emotionalWeight, interaction.outcome].filter(Boolean).join(" · ")}
                  </div>
                )}
                {interaction.summary && (
                  <div style={{ fontSize: "12px", color: "var(--ink-2)", lineHeight: 1.5 }}>{interaction.summary}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}