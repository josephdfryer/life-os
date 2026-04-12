import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import { enrichWithAttention } from "@/lib/attention"
import { isBirthdayToday, isBirthdayThisWeek } from "@/lib/utils"
import AttentionCard from "@/components/today/AttentionCard"
import BirthdayCard from "@/components/today/BirthdayCard"
import type { Person, Interaction } from "@/types"

export const dynamic = "force-dynamic"

function parsePersonFromDb(raw: {
  id: string
  createdAt: Date
  updatedAt: Date
  first: string
  last: string
  headline: string | null
  email: string | null
  phone: string | null
  birthday: string | null
  closeness: number
  tags: string
  values: string
  notes: string | null
  color: string | null
  colorSoft: string | null
  interactions: {
    id: string
    createdAt: Date
    personId: string
    eventId: string | null
    event: {
      id: string
      createdAt: Date
      name: string
      type: string
      timestamp: Date
      placeId: string | null
      notes: string | null
      transcript: string | null
      metadata: string | null
    } | null
    type: string
    timestamp: Date
    duration: number | null
    emotionalWeight: string | null
    outcome: string | null
    summary: string | null
    notes: string | null
    actionItems: string | null
    billable: boolean
    amount: number | null
    direction: string | null
    sourceFileId: string | null
    sourceFile: {
      id: string
      createdAt: Date
      filename: string
      format: string
      filePath: string
      sizeBytes: number
    } | null
  }[]
}): Person & { interactions: Interaction[] } {
  return {
    ...raw,
    tags: parseTags(raw.tags) as unknown as string[],
    values: parseTags(raw.values) as unknown as string[],
    interactions: raw.interactions.map(ix => ({
      ...ix,
      actionItems: parseTags(ix.actionItems) as unknown as string[],
      event: ix.event
        ? { ...ix.event, metadata: ix.event.metadata ? JSON.parse(ix.event.metadata) : null }
        : null,
    })),
  } as unknown as Person & { interactions: Interaction[] }
}

export default async function TodayPage() {
  const raw = await db.person.findMany({
    include: {
      interactions: {
        include: {
          event: true,
          sourceFile: true,
        },
        orderBy: { timestamp: "desc" },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  const persons = raw.map(parsePersonFromDb).map(enrichWithAttention)

  // Birthdays today
  const birthdaysToday = persons.filter(p => isBirthdayToday(p.birthday))

  // Birthdays this week (but not today)
  const birthdaysThisWeek = persons.filter(
    p => !isBirthdayToday(p.birthday) && isBirthdayThisWeek(p.birthday)
  )

  // Active today — had interaction today
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const activeToday = persons.filter(p =>
    p.interactions.some(ix => new Date(ix.timestamp) >= todayStart)
  )

  // Overdue — sorted descending
  const overdue = persons
    .filter(p => p.attentionScore >= 1.0)
    .sort((a, b) => b.attentionScore - a.attentionScore)

  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: "28px",
          fontWeight: 600,
          color: "var(--ink)",
          margin: "0 0 4px",
        }}>
          Today
        </h1>
        <div style={{ fontSize: "12px", color: "var(--ink-3)" }}>{date}</div>
      </div>

      {birthdaysToday.length > 0 && (
        <Section title="🎂 Birthdays Today">
          {birthdaysToday.map(p => (
            <BirthdayCard key={p.id} person={p} isToday={true} />
          ))}
        </Section>
      )}

      {birthdaysThisWeek.length > 0 && (
        <Section title="Birthdays This Week">
          {birthdaysThisWeek.map(p => (
            <BirthdayCard key={p.id} person={p} isToday={false} />
          ))}
        </Section>
      )}

      {activeToday.length > 0 && (
        <Section title="Active Today">
          {activeToday.map(p => (
            <AttentionCard key={p.id} person={p} />
          ))}
        </Section>
      )}

      {overdue.length > 0 ? (
        <Section title={`Overdue for Contact (${overdue.length})`}>
          {overdue.map(p => (
            <AttentionCard key={p.id} person={p} />
          ))}
        </Section>
      ) : (
        persons.length > 0 && (
          <div style={{
            padding: "32px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: "13px",
          }}>
            You're all caught up. No one is overdue for contact.
          </div>
        )
      )}

      {persons.length === 0 && (
        <div style={{
          padding: "48px 32px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          textAlign: "center",
        }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "20px", color: "var(--ink)", marginBottom: "8px" }}>
            Welcome to Persons
          </div>
          <div style={{ fontSize: "12px", color: "var(--ink-3)", marginBottom: "20px" }}>
            Add your first contact to get started.
          </div>
          <a
            href="/contacts"
            style={{
              display: "inline-block",
              padding: "9px 20px",
              background: "var(--accent)",
              color: "#fff",
              borderRadius: "7px",
              textDecoration: "none",
              fontSize: "12px",
              fontWeight: 500,
            }}
          >
            Go to Contacts →
          </a>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "32px" }}>
      <h2 style={{
        fontSize: "10px",
        fontWeight: 500,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--ink-4)",
        margin: "0 0 10px",
      }}>
        {title}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {children}
      </div>
    </div>
  )
}
