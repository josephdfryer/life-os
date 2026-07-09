import Link from "next/link"

const importModes = [
  {
    href: "/import/people",
    title: "People",
    count: "vCard / CSV",
    summary: "Bring in people records, review duplicates, fill missing fields, and choose what gets saved.",
    action: "Import People",
  },
  {
    href: "/import/interactions",
    title: "Interactions",
    count: "Gmail / text / files",
    summary: "Turn Gmail mail, messages, notes, and transcripts into Interactions for review.",
    action: "Import Interactions",
  },
]

export default function ImportPage() {
  return (
    <main style={{ maxWidth: "980px", margin: "0 auto", padding: "42px 24px 56px" }}>
      <header style={{ marginBottom: "28px" }}>
        <h1 style={{ fontFamily: "var(--font-display), serif", fontSize: "42px", lineHeight: 1.05, fontWeight: 600, color: "var(--ink)", margin: "0 0 8px" }}>
          Import
        </h1>
        <div style={{ fontSize: "13px", color: "var(--ink-3)" }}>
          Choose the flow that matches the source material.
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
        {importModes.map(mode => (
          <Link
            key={mode.href}
            href={mode.href}
            style={{
              display: "grid",
              minHeight: "190px",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              background: "var(--surface)",
              padding: "18px",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <div>
              <div style={{ fontSize: "10px", color: "var(--ink-4)", marginBottom: "8px" }}>{mode.count}</div>
              <h2 style={{ fontFamily: "var(--font-display), serif", fontSize: "30px", lineHeight: 1.05, fontWeight: 600, color: "var(--ink)", margin: 0 }}>
                {mode.title}
              </h2>
              <p style={{ fontSize: "12px", lineHeight: 1.6, color: "var(--ink-3)", margin: "12px 0 0" }}>
                {mode.summary}
              </p>
            </div>
            <div style={{ alignSelf: "end", marginTop: "22px", display: "inline-flex", width: "fit-content", border: "1px solid var(--border)", borderRadius: "7px", padding: "7px 10px", fontSize: "12px", color: "var(--ink-2)" }}>
              {mode.action} →
            </div>
          </Link>
        ))}
      </section>
    </main>
  )
}
