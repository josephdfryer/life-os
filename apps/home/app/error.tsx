"use client"

export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="dashboard-page min-h-screen pb-12">
      <div className="dashboard-page-inner" style={{ maxWidth: "560px", margin: "0 auto", paddingTop: "72px" }}>
        <h1 className="dashboard-greeting-title" style={{ marginBottom: "12px" }}>
          Today couldn&apos;t load
        </h1>
        <p style={{ color: "var(--ink-3)", fontSize: "14px", lineHeight: 1.6, marginBottom: "24px" }}>
          Something went wrong while loading your dashboard. Your data is safe — try reloading, or open a section from the menu.
        </p>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "10px 18px",
              borderRadius: "var(--radius-pill)",
              border: "none",
              background: "var(--cognac)",
              color: "#fff",
              font: "inherit",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          <a
            href="/inbox"
            className="dashboard-app-link"
            style={{
              padding: "10px 18px",
              borderRadius: "var(--radius-pill)",
              border: "1px solid rgba(196, 165, 116, 0.24)",
            }}
          >
            Open Inbox
          </a>
        </div>
        {error.digest ? (
          <p style={{ marginTop: "28px", fontSize: "11px", color: "var(--ink-4)" }}>
            Error {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  )
}
