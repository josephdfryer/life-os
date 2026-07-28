import { dayKey, shiftDay, HOME_TIME_ZONE } from "@/lib/daily"

export default function DayReviewNavigation({ day, tz = HOME_TIME_ZONE }: { day: string; tz?: string }) {
  const today = dayKey(new Date(), tz)
  const previous = shiftDay(day, -1)
  const next = shiftDay(day, 1)
  const isToday = day === today
  const label = isToday
    ? "Today"
    : new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
        timeZone: tz,
        weekday: "long",
        month: "long",
        day: "numeric",
      })

  return (
    <nav className="day-review-nav" aria-label="Daily review date">
      <a href={`/?day=${previous}`} aria-label="Review previous day">← Previous day</a>
      <div>
        <span>Daily review</span>
        <strong>{label}</strong>
      </div>
      {isToday
        ? <span className="day-review-disabled">Next day →</span>
        : <a href={next === today ? "/" : `/?day=${next}`} aria-label="Review next day">Next day →</a>}
    </nav>
  )
}
