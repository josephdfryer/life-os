"use client"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0f1a22", color: "#f7f4ee", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: "560px", margin: "0 auto", padding: "72px 24px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 500, marginBottom: "12px" }}>
            LifeOS couldn&apos;t load
          </h1>
          <p style={{ color: "#9aa8b0", fontSize: "14px", lineHeight: 1.6, marginBottom: "24px" }}>
            A server error blocked this page. Try reloading — if it keeps failing, open Inbox or sign out and back in.
          </p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "10px 18px",
                borderRadius: "999px",
                border: "none",
                background: "#b5835a",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
            <a
              href="/inbox"
              style={{
                padding: "10px 18px",
                borderRadius: "999px",
                border: "1px solid rgba(196, 165, 116, 0.35)",
                color: "#f7f4ee",
                fontSize: "13px",
                textDecoration: "none",
              }}
            >
              Open Inbox
            </a>
          </div>
          {error.digest ? (
            <p style={{ marginTop: "28px", fontSize: "11px", color: "#6a858f" }}>
              Error {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  )
}
