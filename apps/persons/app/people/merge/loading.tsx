export default function Loading() {
  return (
    <div style={{ maxWidth: "1020px", margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ width: "80px", height: "12px", background: "var(--border)", borderRadius: "4px", marginBottom: "20px" }} />
      <div style={{ width: "220px", height: "28px", background: "var(--border)", borderRadius: "4px", marginBottom: "32px" }} />
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "14px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ height: "64px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }} />
          ))}
        </div>
        <div style={{ height: "400px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }} />
      </div>
    </div>
  )
}
