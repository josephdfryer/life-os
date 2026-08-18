"use client"

import { signIn } from "next-auth/react"
import { useEffect } from "react"

export function AutoGoogleSignIn({ callbackUrl }: { callbackUrl: string }) {
  useEffect(() => {
    void signIn("google", { callbackUrl })
  }, [callbackUrl])

  return <p style={{ color: "var(--ink-3)" }}>Opening Google sign-in…</p>
}
