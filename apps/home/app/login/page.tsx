"use client"

import { signIn } from "next-auth/react"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

function LoginContent() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") ?? "/"

  return (
    <div className="login-page">
      <div className="login-panel">
        <div className="login-title">Life OS</div>
        <p className="login-copy">Sign in once, then move through your apps.</p>
        <button className="login-button" onClick={() => signIn("google", { callbackUrl })}>
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
