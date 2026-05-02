import Link from "next/link"
import PersonAvatar from "./PersonAvatar"
import { relativeTime, parseTags } from "@/lib/utils"
import type { PersonWithAttention } from "@/types"

type Props = {
  person: PersonWithAttention
}

const MAX_TAGS = 3

// Cadence thresholds matching attention.ts
const CADENCE_DAYS: Record<number, number> = { 1: 0, 2: 90, 3: 21, 4: 10 }

function urgencyColor(score: number, personColor: string | null | undefined): string {
  if (score < 0.5) return personColor ?? "var(--accent)"
  if (score < 1.0) return "#d4873a"
  return "#c44040"
}

export default function PersonCard({ person }: Props) {
  const tags = parseTags(person.tags as unknown as string)
  const overdue = person.attentionScore >= 1.0
  const cadenceDays = CADENCE_DAYS[person.closeness] ?? 21
  const urgencyRatio = Math.min(1, person.attentionScore)
  const hasEverContacted = person.lastInteractionDate !== null

  return (
    <Link href={`/contacts/${person.id}`} style={{ textDecoration: "none", display: "block" }}>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        cursor: "pointer",
        transition: "border-color 0.1s, background 0.1s",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = person.color ?? "var(--accent)"
        el.style.background = "var(--surface)"
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = "var(--border)"
        el.style.background = "var(--surface)"
      }}>
        <PersonAvatar
          first={person.first}
          last={person.last}
          color={person.color}
          colorSoft={person.colorSoft}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
            <span style={{ color: "var(--ink)", fontWeight: 500, fontSize: "13px" }}>
              {person.first} {person.last}
            </span>
            {overdue && (
              <span style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "var(--accent)",
                display: "inline-block",
                flexShrink: 0,
              }} title="Overdue for contact" />
            )}
          </div>

          {person.headline && (
            <div style={{ color: "var(--ink-3)", fontSize: "11px", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {person.headline}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            {tags.slice(0, MAX_TAGS).map((tag: string) => (
              <span key={tag} style={{
                background: person.colorSoft ?? "var(--surface2)",
                color: person.color ?? "var(--ink-2)",
                borderRadius: "4px",
                padding: "1px 7px",
                fontSize: "10px",
                fontWeight: 500,
                letterSpacing: "0.02em",
              }}>
                {tag}
              </span>
            ))}
            {tags.length > MAX_TAGS && (
              <span style={{ color: "var(--ink-4)", fontSize: "10px" }}>+{tags.length - MAX_TAGS}</span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "5px", flexShrink: 0 }}>
          <span style={{
            color: overdue ? "#c44040" : "var(--ink-4)",
            fontSize: "11px",
          }}>
            {relativeTime(person.lastInteractionDate)}
          </span>

          {/* Contact urgency bar — fills and turns red as relationship goes overdue */}
          <div title={hasEverContacted ? `${person.daysSinceLast}d ago · target every ${cadenceDays}d` : "Never contacted"} style={{ width: "48px", height: "3px", background: "var(--surface2)", borderRadius: "2px", overflow: "hidden" }}>
            {hasEverContacted && (
              <div style={{
                width: `${Math.round(urgencyRatio * 100)}%`,
                height: "100%",
                background: urgencyColor(urgencyRatio, person.color),
                borderRadius: "2px",
                transition: "width 0.3s, background 0.3s",
              }} />
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
