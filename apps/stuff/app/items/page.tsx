import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function ItemsPage() {
  const items = await db.item.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 24px" }}>
      <div style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: "32px",
      }}>
        <h1 style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: "28px",
          fontWeight: 600,
          color: "var(--ink)",
          letterSpacing: "-0.02em",
          margin: 0,
        }}>
          Everything
        </h1>
        <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>
          {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </div>

      {items.length === 0 ? (
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "64px 32px",
          textAlign: "center",
        }}>
          <div style={{
            fontSize: "13px",
            color: "var(--ink-3)",
            marginBottom: "6px",
          }}>
            Nothing here yet.
          </div>
          <div style={{ fontSize: "12px", color: "var(--ink-4)" }}>
            Add your first item to start cataloguing what you own.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          {items.map(item => (
            <div
              key={item.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: "16px",
                transition: "border-color 0.1s",
                cursor: "pointer",
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--accent)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              {/* Asset ID badge */}
              <span style={{
                fontSize: "10px",
                color: "var(--ink-4)",
                fontVariantNumeric: "tabular-nums",
                minWidth: "60px",
              }}>
                {item.assetId}
              </span>

              {/* Name + category */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--ink)", marginBottom: "2px" }}>
                  {item.name}
                </div>
                {item.category && (
                  <div style={{ fontSize: "11px", color: "var(--ink-4)" }}>
                    {item.category}
                  </div>
                )}
              </div>

              {/* Make / model */}
              {(item.make || item.model) && (
                <div style={{ fontSize: "11px", color: "var(--ink-3)", textAlign: "right" }}>
                  {[item.make, item.model].filter(Boolean).join(" ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
