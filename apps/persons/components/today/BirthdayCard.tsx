import Link from "next/link"
import PersonAvatar from "@/components/persons/PersonAvatar"
import { formatBirthday, daysUntilBirthday } from "@/lib/utils"
import type { Person } from "@/types"

type Props = {
  person: Person
  isToday: boolean
}

export default function BirthdayCard({ person, isToday }: Props) {
  const days = daysUntilBirthday(person.birthday)

  return (
    <Link href={`/people/${person.id}`} style={{ textDecoration: "none" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        background: isToday ? "var(--accent-soft)" : "var(--surface)",
        border: `1px solid ${isToday ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "8px",
        cursor: "pointer",
      }}>
        <PersonAvatar
          first={person.first}
          last={person.last}
          color={person.color}
          colorSoft={person.colorSoft}
          size={34}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--ink)" }}>
            {person.first} {person.last}
          </div>
          <div style={{ fontSize: "11px", color: isToday ? "var(--accent)" : "var(--ink-3)" }}>
            {formatBirthday(person.birthday)}
            {isToday ? " · 🎂 Today!" : days === 1 ? " · Tomorrow" : ` · In ${days} days`}
          </div>
        </div>
      </div>
    </Link>
  )
}
