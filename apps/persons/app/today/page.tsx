import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import { enrichWithAttention } from "@/lib/attention"
import { isBirthdayToday, isBirthdayThisWeek } from "@/lib/utils"
import AttentionCard from "@/components/today/AttentionCard"
import BirthdayCard from "@/components/today/BirthdayCard"
import type { Person } from "@/types"

export const dynamic = "force-dynamic"

export default async function TodayPage() {
  // Only load persons who are relevant to today:
  //   - closeness >= 2 (Friends / Inner Circle) for attention tracking
  //   - OR have a birthday set
  // Only fetch the last 5 interaction timestamps per person — no event/sourceFile joins.
  const raw = await db.person.findMany({
    where: {
      OR: [
        { closeness: { gte: 2 } },
        { birthday: { not: null } },
      ],
    },
    select: {
      id: true, createdAt: true, updatedAt: true,
      first: true, last: true, headline: true,
      emails: true, phones: true, birthday: true,
      closeness: true, tags: true, values: true,
      notes: true, company: true, location: true,
      linkedin: true, twitter: true, website: true,
      color: true, colorSoft: true,
      interactions: {
        select: { id: true, createdAt: true, personId: true, eventId: true,
          type: true, timestamp: true, duration: true, emotionalWeight: true,
          outcome: true, summary: true, notes: true, actionItems: true,
          billable: true, amount: true, direction: true, sourceFileId: true },
        orderBy: { timestamp: "desc" },
        take: 5,
      },
    },
    orderBy: { createdAt: "asc" },
  })

  const persons = raw.map(p =>
    enrichWithAttention({
      ...(p as unknown as Person),
      tags:   parseTags(p.tags)   as unknown as string[],
      values: parseTags(p.values) as unknown as string[],
      emails: parseTags(p.emails) as unknown as string[],
      phones: parseTags(p.phones) as unknown as string[],
      interactions: p.interactions.map(ix => ({
        ...ix,
        actionItems: parseTags(ix.actionItems) as unknown as string[],
        event: null,
        sourceFile: null,
      })) as never,
      plans: [],
    })
  )

  const birthdaysToday    = persons.filter(p => isBirthdayToday(p.birthday))
  const birthdaysThisWeek = persons.filter(p => !isBirthdayToday(p.birthday) && isBirthdayThisWeek(p.birthday))

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const activeToday = persons.filter(p =>
    p.interactions.some(ix => new Date(ix.timestamp) >= todayStart)
  )

  const overdue = persons
    .filter(p => p.attentionScore >= 1.0)
    .sort((a, b) => b.attentionScore - a.attentionScore)

  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  })

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontFamily: "var(--font-playfair), serif", fontSize: "28px", fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>
          Today
        </h1>
        <div style={{ fontSize: "12px", color: "var(--ink-3)" }}>{date}</div>
      </div>

      {birthdaysToday.length > 0 && (
        <Section title="🎂 Birthdays Today">
          {birthdaysToday.map(p => <BirthdayCard key={p.id} person={p} isToday={true} />)}
        </Section>
      )}

      {birthdaysThisWeek.length > 0 && (
        <Section title="Birthdays This Week">
          {birthdaysThisWeek.map(p => <BirthdayCard key={p.id} person={p} isToday={false} />)}
        </Section>
      )}

      {activeToday.length > 0 && (
        <Section title="Active Today">
          {activeToday.map(p => <AttentionCard key={p.id} person={p} />)}
        </Section>
      )}

      {overdue.length > 0 ? (
        <Section title={`Overdue for Contact (${overdue.length})`}>
          {overdue.map(p => <AttentionCard key={p.id} person={p} />)}
        </Section>
      ) : (
        persons.length > 0 && (
          <div style={{ padding: "32px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", textAlign: "center", color: "var(--ink-3)", fontSize: "13px" }}>
            You&apos;re all caught up. No one is overdue for contact.
          </div>
        )
      )}

      {persons.length === 0 && (
        <div style={{ padding: "48px 32px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-playfair), serif", fontSize: "20px", color: "var(--ink)", marginBottom: "8px" }}>
            Welcome to Persons
          </div>
          <div style={{ fontSize: "12px", color: "var(--ink-3)", marginBottom: "20px" }}>
            Add your first contact to get started.
          </div>
          <a href="/contacts" style={{ display: "inline-block", padding: "9px 20px", background: "var(--accent)", color: "#fff", borderRadius: "7px", textDecoration: "none", fontSize: "12px", fontWeight: 500 }}>
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
      <h2 style={{ fontSize: "10px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-4)", margin: "0 0 10px" }}>
        {title}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {children}
      </div>
    </div>
  )
}
