import { redirect } from "next/navigation"
import { auth } from "@/auth"
import CalendarView from "@/components/calendar/CalendarView"
import { parseCalendarDate, parseCalendarMode, toDateKey } from "@/lib/calendar"

export const dynamic = "force-dynamic"

export default async function EventsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; date?: string }>
}) {
  const session = await auth()
  if (!session?.user?.email) redirect("/login")

  const { mode: modeParam, date: dateParam } = await searchParams
  const mode = parseCalendarMode(modeParam)
  const date = toDateKey(parseCalendarDate(dateParam))

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "28px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "0 0 6px",
          }}
        >
          Calendar
        </h1>
        <p style={{ margin: 0, fontSize: "12px", color: "var(--ink-3)" }}>
          Week and month views over the shared event graph.
        </p>
      </div>
      <CalendarView initialMode={mode} initialDate={date} />
    </div>
  )
}