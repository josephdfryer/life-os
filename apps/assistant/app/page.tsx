export default function Home() {
  return (
    <main style={{ width: "min(100%, 760px)", margin: "0 auto", padding: "36px 24px 48px" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", fontWeight: 400, letterSpacing: "-0.02em", margin: "0 0 8px" }}>
        Life OS Assistant
      </h1>
      <p style={{ color: "var(--ink-3)", fontSize: "14px", margin: "0 0 24px", maxWidth: "520px" }}>
        WhatsApp to Claude bridge. Send a WhatsApp message to get started.
      </p>
      <section style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-sm)", padding: "22px 24px" }}>
        <p style={{ color: "var(--ink-2)", margin: "0 0 16px" }}>Service status and operational checks live behind the health endpoint.</p>
        <a
          href="/api/health"
          style={{
            display: "inline-flex",
            borderRadius: "var(--radius-pill)",
            background: "var(--cognac)",
            color: "#fff",
            padding: "9px 18px",
            fontSize: "13px",
            fontWeight: 450,
            textDecoration: "none",
          }}
        >
          Health check
        </a>
      </section>
    </main>
  )
}
