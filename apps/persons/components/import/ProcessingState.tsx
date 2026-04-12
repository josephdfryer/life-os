"use client"

import { useEffect, useState } from "react"

const STEPS = [
  "Reading file contents…",
  "Identifying people and interactions…",
  "Inferring closeness and context…",
  "Structuring results…",
]

export default function ProcessingState() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setStep(s => (s + 1) % STEPS.length)
    }, 1400)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div style={{ marginBottom: "24px" }}>
        <div style={{
          width: "40px",
          height: "40px",
          border: "2px solid var(--border)",
          borderTopColor: "var(--accent)",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
          margin: "0 auto",
        }} />
      </div>
      <div style={{ color: "var(--ink)", fontSize: "14px", marginBottom: "8px" }}>
        Analyzing with Claude…
      </div>
      <div style={{ color: "var(--ink-3)", fontSize: "12px", height: "18px", transition: "opacity 0.3s" }}>
        {STEPS[step]}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
