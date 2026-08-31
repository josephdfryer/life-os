export default function PersonCardSkeleton() {
  return (
    <div
      style={{
        minHeight: "74px",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) minmax(180px, 280px) auto",
        alignItems: "center",
        gap: "14px",
        padding: "11px 14px",
        background: "var(--surface)",
        border: "1px solid transparent",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Avatar skeleton */}
      <div
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          background: "linear-gradient(90deg, var(--surface-2) 25%, var(--surface) 50%, var(--surface-2) 75%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
        }}
      />

      {/* Identity skeleton */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
        <div
          style={{
            height: "20px",
            width: "60%",
            borderRadius: "4px",
            background: "linear-gradient(90deg, var(--surface-2) 25%, var(--surface) 50%, var(--surface-2) 75%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.5s infinite",
          }}
        />
        <div
          style={{
            height: "14px",
            width: "45%",
            borderRadius: "4px",
            background: "linear-gradient(90deg, var(--surface-2) 25%, var(--surface) 50%, var(--surface-2) 75%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.5s infinite",
            animationDelay: "0.1s",
          }}
        />
      </div>

      {/* Relationship skeleton */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
        <div
          style={{
            height: "12px",
            width: "100px",
            borderRadius: "4px",
            background: "linear-gradient(90deg, var(--surface-2) 25%, var(--surface) 50%, var(--surface-2) 75%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.5s infinite",
            animationDelay: "0.2s",
          }}
        />
        <div
          style={{
            height: "18px",
            width: "80px",
            borderRadius: "12px",
            background: "linear-gradient(90deg, var(--surface-2) 25%, var(--surface) 50%, var(--surface-2) 75%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.5s infinite",
            animationDelay: "0.3s",
          }}
        />
      </div>

      {/* Arrow skeleton */}
      <div
        style={{
          width: "20px",
          height: "20px",
          borderRadius: "4px",
          background: "linear-gradient(90deg, var(--surface-2) 25%, var(--surface) 50%, var(--surface-2) 75%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          animationDelay: "0.4s",
        }}
      />

      <style jsx>{`
        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }
      `}</style>
    </div>
  )
}
