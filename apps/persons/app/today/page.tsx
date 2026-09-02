import { cookies } from "next/headers"
import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"
import { parseTags, isBirthdayToday, isBirthdayThisWeek, isTimestampToday, daysUntilBirthday } from "@/lib/utils"
import { enrichWithAttention } from "@/lib/attention"
import { isUnreviewedBulkContact } from "@life-os/alignment/pure"
import AttentionCard from "@/components/today/AttentionCard"
import BirthdayCard from "@/components/today/BirthdayCard"
import { TimezonePicker, resolveTimeZone, TZ_COOKIE } from "@life-os/ui"
import type { Person } from "@/types"
import { requireAccess } from "@/server/domain/access"

export const dynamic = "force-dynamic"

export default async function TodayPage() {
  const actor = await requireAccess("people.read")
  const now = new Date()
  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)
  // Only load persons who are relevant to today:
  //   - closeness >= 2 (Nurture / Friend / Inner Circle) for attention tracking
  //   - OR have a birthday set
  // Only fetch the last 5 interaction timestamps per person — no event/sourceFile joins.
  const raw = await db.person.findMany({
    where: {
      workspaceId: actor.workspaceId,
      OR: [
        { closeness: { gte: 2 } },
        { birthday: { not: null } },
      ],
    },
    select: {
      id: true, createdAt: true, updatedAt: true,
      first: true, last: true, title: true, headline: true,
      emails: true, phones: true, birthday: true,
      closeness: true, tags: true, values: true, source: true,
      notes: true, company: true, location: true,
      linkedin: true, twitter: true, website: true,
      color: true, colorSoft: true,
      interactions: {
        where: { timestamp: { lte: now } },
        select: { id: true, createdAt: true, personId: true, eventId: true,
          type: true, timestamp: true, duration: true, emotionalWeight: true,
          outcome: true, summary: true, notes: true, actionItems: true,
          billable: true, amount: true, direction: true, sourceFileId: true },
        orderBy: { timestamp: "desc" },
        take: 5,
      },
      plans: {
        where: { status: "active" },
        select: { id: true, status: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
  })

  const suppressedImportedIds = new Set(raw
    .filter(p => isUnreviewedBulkContact({
      source: p.source,
      lastInteractionAt: p.interactions[0]?.timestamp ?? null,
      hasActivePlan: p.plans.length > 0,
    }))
    .map(p => p.id))

  const persons = raw.map((p: typeof raw[number]) =>
    enrichWithAttention({
      ...(p as unknown as Person),
      tags:   parseTags(p.tags)   as unknown as string[],
      values: parseTags(p.values) as unknown as string[],
      emails: parseTags(p.emails) as unknown as string[],
      phones: parseTags(p.phones) as unknown as string[],
      interactions: p.interactions.map((ix: typeof p.interactions[number]) => ({
        ...ix,
        actionItems: parseTags(ix.actionItems) as unknown as string[],
        amount: centsToDollars(ix.amount),
        event: null,
        sourceFile: null,
      })) as never,
      plans: p.plans as never,
    })
  )

  const birthdaysToday    = persons.filter(p => isBirthdayToday(p.birthday, tz))
  const birthdaysThisWeek = persons
    .filter(p => !isBirthdayToday(p.birthday, tz) && isBirthdayThisWeek(p.birthday, tz))
    .sort((a, b) => (daysUntilBirthday(a.birthday, tz) ?? 999) - (daysUntilBirthday(b.birthday, tz) ?? 999))

  const activeToday = persons.filter(p =>
    p.interactions.some(ix => isTimestampToday(ix.timestamp, tz))
  )

  const overdue = persons
    .filter(p => p.attentionScore >= 1.0 && !suppressedImportedIds.has(p.id))
    .sort((a, b) => b.attentionScore - a.attentionScore)

  // Today's birthdays count as "needs attention" too — a birthday is a
  // one-day window, not something that can wait like an overdue check-in.
  const needsAttentionCount = birthdaysToday.length + overdue.length

  const date = now.toLocaleDateString("en-US", {
    timeZone: tz, weekday: "long", month: "long", day: "numeric",
  })

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontFamily: "var(--font-display), serif", fontSize: "28px", fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>
          Today
        </h1>
        <div style={{ fontSize: "12px", color: "var(--ink-3)" }}>{date}</div>
        <TimezonePicker current={tz} />
      </div>

      {needsAttentionCount > 0 ? (
        <Section title={`Needs Attention (${needsAttentionCount})`}>
          {birthdaysToday.map(p => <BirthdayCard key={p.id} person={p} isToday={true} tz={tz} />)}
          {overdue.map(p => <AttentionCard key={p.id} person={p} />)}
        </Section>
      ) : (
        persons.length > 0 && (
          <div style={{ padding: "32px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", textAlign: "center", color: "var(--ink-3)", fontSize: "13px" }}>
            You&apos;re all caught up. No one needs attention today.
          </div>
        )
      )}

      {birthdaysThisWeek.length > 0 && (
        <Section title="Birthdays This Week">
          {birthdaysThisWeek.map(p => <BirthdayCard key={p.id} person={p} isToday={false} tz={tz} />)}
        </Section>
      )}

      {activeToday.length > 0 && (
        <Section title="Active Today">
          {activeToday.map(p => <AttentionCard key={p.id} person={p} />)}
        </Section>
      )}

      {persons.length === 0 && (
        <div style={{ padding: "48px 32px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display), serif", fontSize: "20px", color: "var(--ink)", marginBottom: "8px" }}>
            Welcome to Persons
          </div>
          <div style={{ fontSize: "12px", color: "var(--ink-3)", marginBottom: "20px" }}>
            Add your first person to get started.
          </div>
          <a href="/persons" style={{ display: "inline-block", padding: "9px 20px", background: "var(--accent)", color: "#fff", borderRadius: "7px", textDecoration: "none", fontSize: "12px", fontWeight: 500 }}>
            Go to Persons →
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
