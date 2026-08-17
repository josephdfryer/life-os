"use client"

// Bottom-sheet overlay for narrow viewports — generalized from the
// full-screen modal pattern already used by PersonsClient's "delete all"
// confirmation (position:fixed, inset:0, click-outside-to-close). A sheet
// anchored to the bottom (rather than centered) keeps the trigger's context
// visible and leaves room for the on-screen keyboard when a search input
// inside is focused.

export function MobileFilterSheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "flex-end" }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: "100%",
          maxHeight: "80vh",
          overflowY: "auto",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderBottom: "none",
          borderRadius: "16px 16px 0 0",
          boxShadow: "var(--shadow-lg)",
          padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "16px", color: "var(--ink)" }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: "6px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", color: "var(--ink-3)", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}
          >
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
