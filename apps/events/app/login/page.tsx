"use client"

import { signIn } from "next-auth/react"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

function LoginContent() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") ?? "/events"

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          padding: "48px 44px",
          width: "360px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display), serif",
            fontSize: "28px",
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "-0.02em",
            marginBottom: "8px",
          }}
        >
          Events
        </div>
        <p style={{ color: "var(--ink-3)", fontSize: "12px", marginBottom: "36px", lineHeight: 1.6 }}>
          Your calendar of what happened in the world
        </p>
        <button
          onClick={() => signIn("google", { callbackUrl })}
          style={{
            width: "100%",
            padding: "11px 16px",
            borderRadius: "10px",
            background: "var(--ink)",
            color: "var(--bg)",
            fontSize: "12px",
            fontWeight: 500,
            fontFamily: "inherit",
            border: "none",
            cursor: "pointer",
          }}
        >
          Sign in with Google
        </button>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}