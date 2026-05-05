import Link from "next/link"
import PersonAvatar from "@/components/persons/PersonAvatar"
import { relativeTime, closenessLabel } from "@/lib/utils"
import type { PersonWithAttention } from "@/types"

type Props = {
  person: PersonWithAttention
}

const CADENCE_DAYS: Record<number, number> = { 2: 90, 3: 21, 4: 10 }

function overdueLabel(person: PersonWithAttention): string | null {
  if (person.attentionScore < 1) return null
  const cadence = CADENCE_DAYS[person.closeness]
  if (!cadence) return null
  const days = person.daysSinceLast
  if (days === null) return "overdue"
  const overdueDays = Math.round(days - cadence)
  if (overdueDays < 1) return "overdue"
  if (overdueDays === 1) return "1 day overdue"
  if (overdueDays < 14) return `${overdueDays} days overdue`
  if (overdueDays < 60) return `${Math.round(overdueDays / 7)} weeks overdue`
  return `${Math.round(overdueDays / 30)} months overdue`
}

export default function AttentionCard({ person }: Props) {
  const label = overdueLabel(person)

  return (
    <Link href={`/people/${person.id}`} style={{ textDecoration: "none" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${person.color ?? "var(--accent)"}`,
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--ink)" }}>
            {person.first} {person.last}
          </div>
          <div style={{ fontSize: "11px", color: "var(--ink-3)" }}>
            {closenessLabel(person.closeness)} · Last: {relativeTime(person.lastInteractionDate)}
          </div>
        </div>
        {label && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 500 }}>
              {label}
            </div>
          </div>
        )}
      </div>
    </Link>
  )
}
