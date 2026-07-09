import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { getWorkspaceId } from "@/lib/workspace"
import {
  eventListWindow,
  formatEventTime,
  formatEventType,
  parseEventListView,
  type EventListView,
} from "@/lib/events"

export const dynamic = "force-dynamic"

const VIEWS: { id: EventListView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "all", label: "All" },
]

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>
}) {
  const session = await auth()
  if (!session?.user?.email) redirect("/login")
  const workspaceId = await getWorkspaceId(session.user.email)
  const { view: viewParam, q } = await searchParams
  const view = parseEventListView(viewParam)
  const search = q?.trim()

  const window = eventListWindow(view)
  const orderBy = view === "past" || view === "all" ? { start: "desc" as const } : { start: "asc" as const }

  const events = await db.event.findMany({
    where: {
      workspaceId,
      ...(window ? { start: window } : {}),
      ...(search ? { name: { contains: search } } : {}),
    },
    include: {
      place: { select: { name: true } },
      interactions: {
        where: { personId: { not: null } },
        include: { person: { select: { first: true, last: true } } },
        take: 4,
      },
      _count: { select: { interactions: true } },
    },
    orderBy,
    take: 100,
  })

  return (
    <div style={{ width: "min(100%, var(--content-max, 1100px))", margin: "0 auto", padding: "36px 24px 48px" }}>
      <style>{`.event-row:hover { border-color: var(--cognac-soft) !important; box-shadow: var(--shadow) !important; }`}</style>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "28px",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "28px",
              fontWeight: 400,
              letterSpacing: "-0.02em",
              margin: "0 0 6px",
            }}
          >
            Timeline
          </h1>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--ink-3)" }}>
            Events exist in the world — your interactions with them live on each person.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <a
          href="/events/calendar"
          style={{
            border: "1px solid var(--border)",
            color: "var(--ink-3)",
            borderRadius: "var(--radius-pill)",
            padding: "9px 18px",
            fontSize: "13px",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Calendar view
        </a>
        <a
          href="/events/new"
          style={{
            background: "var(--cognac)",
            color: "#fff",
            borderRadius: "var(--radius-pill)",
            padding: "9px 18px",
            fontSize: "13px",
            fontWeight: 450,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          New event
        </a>
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
        {VIEWS.map((item) => {
          const params = new URLSearchParams()
          params.set("view", item.id)
          if (search) params.set("q", search)
          const active = view === item.id
          return (
            <a
              key={item.id}
              href={`/events?${params.toString()}`}
              style={{
                padding: "6px 14px",
                borderRadius: "999px",
                fontSize: "13px",
                textDecoration: "none",
                border: `1px solid ${active ? "var(--cognac-soft)" : "var(--border)"}`,
                background: active ? "var(--cognac-soft)" : "transparent",
                color: active ? "var(--cognac-deep)" : "var(--ink-3)",
              }}
            >
              {item.label}
            </a>
          )
        })}
      </div>

      <form method="get" action="/events" style={{ marginBottom: "24px", display: "flex", gap: "8px" }}>
        <input type="hidden" name="view" value={view} />
        <input
          name="q"
          defaultValue={search}
          placeholder="Search events…"
          style={{
            flex: 1,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            fontSize: "14px",
            color: "var(--ink)",
            outline: "none",
          }}
        />
      </form>

      {events.length === 0 ? (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-sm)",
            padding: "64px 32px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "13px", color: "var(--ink-3)", marginBottom: "8px" }}>
            {search ? `No events matching "${search}"` : "Nothing on the timeline yet."}
          </div>
          {!search && (
            <a href="/events/new" style={{ fontSize: "12px", color: "var(--cognac)", textDecoration: "none" }}>
              Log your first event
            </a>
          )}
        </div>
      ) : (
        <>
          <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "12px" }}>
            {events.length} event{events.length !== 1 ? "s" : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {events.map((event) => {
              const { date, range } = formatEventTime(new Date(event.start), event.end ? new Date(event.end) : null)
              const attendees = [
                ...new Set(
                  event.interactions
                    .filter((i) => i.person)
                    .map((i) => `${i.person!.first} ${i.person!.last ?? ""}`.trim()),
                ),
              ].slice(0, 3)

              return (
                <a
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="event-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1fr auto",
                    gap: "16px",
                    alignItems: "start",
                    background: "var(--surface)",
                    border: "1px solid transparent",
                    borderRadius: "var(--radius)",
                    boxShadow: "var(--shadow-sm)",
                    padding: "16px 18px",
                    textDecoration: "none",
                    color: "inherit",
                    transition: "border-color 0.1s, box-shadow 0.1s",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "11px", color: "var(--ink-4)", marginBottom: "4px" }}>{date}</div>
                    <div style={{ fontSize: "12px", color: "var(--cognac)" }}>
                      {range}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 400, marginBottom: "4px" }}>{event.name}</div>
                    {attendees.length > 0 && (
                      <div style={{ fontSize: "11px", color: "var(--ink-3)", marginBottom: "4px" }}>
                        with {attendees.join(", ")}
                      </div>
                    )}
                    {event.place && (
                      <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>📍 {event.place.name}</div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span
                      style={{
                        fontSize: "10px",
                        color: "var(--ink-4)",
                        background: "var(--cognac-soft)",
                        padding: "3px 8px",
                        borderRadius: "var(--radius-pill)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatEventType(event.type)}
                    </span>
                    {event._count.interactions > 0 && (
                      <div style={{ fontSize: "10px", color: "var(--ink-4)", marginTop: "6px" }}>
                        {event._count.interactions} interaction{event._count.interactions !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                </a>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
