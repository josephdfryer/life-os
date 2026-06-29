import Link from "next/link"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const people = await db.person.findMany({
    orderBy: [{ first: "asc" }, { last: "asc" }],
    take: 200,
    select: {
      id: true,
      first: true,
      last: true,
      nickname: true,
      headline: true,
      theorySnapshots: {
        where: { status: "current" },
        orderBy: { version: "desc" },
        take: 1,
        select: { version: true, confidence: true, synthesizedAt: true },
      },
    },
  })

  const withTheory = people.filter(p => p.theorySnapshots.length > 0)
  const withoutTheory = people.filter(p => p.theorySnapshots.length === 0)

  return (
    <div style={{ maxWidth: "820px", margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{
        fontFamily: "var(--font-playfair), serif",
        fontSize: "28px",
        fontWeight: 600,
        color: "var(--ink)",
        letterSpacing: "-0.02em",
        margin: "0 0 6px",
      }}>
        Theory of
      </h1>
      <p style={{ fontSize: "12px", color: "var(--ink-3)", margin: "0 0 4px", maxWidth: "560px", lineHeight: 1.6 }}>
        Life OS stores the life. Theory of Person interprets it — a living, versioned, best-effort
        model of a person derived from everything the graph knows.
      </p>
      <p style={{ fontSize: "11px", color: "var(--ink-4)", margin: "0 0 32px", fontStyle: "italic" }}>
        A theory is not truth. It is the current best model based on available evidence.
      </p>

      {people.length === 0 ? (
        <EmptyBlock
          title="No people yet."
          subtitle="Theory of Person derives from the people stored in Life OS. Add people first."
        />
      ) : (
        <>
          {withTheory.length > 0 && (
            <Section label="Living theories">
              {withTheory.map(p => {
                const snap = p.theorySnapshots[0]
                return (
                  <PersonRow
                    key={p.id}
                    id={p.id}
                    name={displayName(p)}
                    headline={p.headline}
                    meta={`v${snap.version} · confidence ${formatConfidence(snap.confidence)} · ${formatDate(snap.synthesizedAt)}`}
                    hasTheory
                  />
                )
              })}
            </Section>
          )}

          <Section label={withTheory.length > 0 ? "No theory yet" : "People"}>
            {withoutTheory.map(p => (
              <PersonRow
                key={p.id}
                id={p.id}
                name={displayName(p)}
                headline={p.headline}
                meta="No theory yet"
                hasTheory={false}
              />
            ))}
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "28px" }}>
      <div style={{
        fontSize: "10px",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--ink-4)",
        marginBottom: "10px",
      }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        {children}
      </div>
    </div>
  )
}

function PersonRow({ id, name, headline, meta, hasTheory }: {
  id: string
  name: string
  headline: string | null
  meta: string
  hasTheory: boolean
}) {
  return (
    <Link
      href={`/person/${id}`}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "13px 18px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        textDecoration: "none",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--ink)" }}>{name}</div>
        {headline && <div style={{ fontSize: "11px", color: "var(--ink-4)", marginTop: "2px" }}>{headline}</div>}
      </div>
      <div style={{
        fontSize: "11px",
        color: hasTheory ? "var(--accent)" : "var(--ink-4)",
        textAlign: "right",
        whiteSpace: "nowrap",
      }}>
        {meta}
      </div>
    </Link>
  )
}

function EmptyBlock({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "12px",
      padding: "56px 32px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: "13px", color: "var(--ink-3)", marginBottom: "6px" }}>{title}</div>
      <div style={{ fontSize: "12px", color: "var(--ink-4)" }}>{subtitle}</div>
    </div>
  )
}

function displayName(p: { first: string; last: string; nickname: string | null }): string {
  return p.nickname || [p.first, p.last].filter(Boolean).join(" ") || "Unknown"
}

function formatConfidence(c: number | null): string {
  return c == null ? "—" : c.toFixed(2)
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
