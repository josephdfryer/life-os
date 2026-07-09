"use client"

import { signIn } from "next-auth/react"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

function LoginContent() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") ?? "/items"

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "16px",
        padding: "48px 44px",
        width: "360px",
        textAlign: "center",
        boxShadow: "0 4px 24px rgba(26,24,20,0.07)",
      }}>
        <div style={{
          fontFamily: "var(--font-display), serif",
          fontSize: "28px",
          fontWeight: 600,
          color: "var(--ink)",
          letterSpacing: "-0.02em",
          marginBottom: "8px",
        }}>
          Stuff
        </div>

        <p style={{
          color: "var(--ink-3)",
          fontSize: "12px",
          marginBottom: "36px",
          lineHeight: 1.6,
        }}>
          Everything you own
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
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            transition: "opacity 0.1s",
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
        >
          <GoogleIcon />
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

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M15.68 8.18c0-.57-.05-1.12-.14-1.64H8v3.1h4.3a3.67 3.67 0 0 1-1.59 2.41v2h2.57c1.5-1.38 2.4-3.42 2.4-5.87z" fill="#4285F4"/>
      <path d="M8 16c2.16 0 3.97-.72 5.29-1.94l-2.57-2a4.8 4.8 0 0 1-2.72.75 4.8 4.8 0 0 1-4.52-3.32H.83v2.06A8 8 0 0 0 8 16z" fill="#34A853"/>
      <path d="M3.48 9.49A4.83 4.83 0 0 1 3.23 8c0-.52.09-1.02.25-1.49V4.45H.83A8 8 0 0 0 0 8c0 1.29.31 2.51.83 3.55l2.65-2.06z" fill="#FBBC05"/>
      <path d="M8 3.18c1.22 0 2.31.42 3.17 1.24l2.37-2.37A8 8 0 0 0 8 0 8 8 0 0 0 .83 4.45l2.65 2.06A4.8 4.8 0 0 1 8 3.18z" fill="#EA4335"/>
    </svg>
  )
}
