import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { auth } from "@/auth"
import { authorizeDevice } from "@/lib/device-authorize"
import { AutoGoogleSignIn } from "./AutoGoogleSignIn"

export const metadata: Metadata = { title: "Connect LifeOS Companion" }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default function DeviceAuthorizePage(props: Props) {
  return <Suspense fallback={<AuthorizationShell><p style={{ color: "var(--ink-3)" }}>Loading device request…</p></AuthorizationShell>}><DeviceAuthorizationContent {...props} /></Suspense>
}

async function DeviceAuthorizationContent({ searchParams }: Props) {
  const query = await searchParams
  const field = (key: string) => typeof query[key] === "string" ? query[key] : ""
  const platform = field("platform")
  const deviceName = field("device_name")
  const appVersion = field("app_version")
  const redirectUri = field("redirect_uri")
  const codeChallenge = field("code_challenge")
  const state = field("state")
  const valid = (platform === "macos" || platform === "ios")
    && deviceName.length > 0 && deviceName.length <= 200
    && appVersion.length > 0 && appVersion.length <= 64
    && (redirectUri === "lifeos-companion://auth/callback" || redirectUri === "persons://auth/callback")
    && /^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)
    && state.length >= 16 && state.length <= 256
  const isPersons = redirectUri === "persons://auth/callback"
  const productName = isPersons ? "Persons" : "LifeOS Companion"

  if (!valid) {
    return <AuthorizationShell>
      <p style={{ margin: "0 0 8px", color: "var(--cognac)", fontSize: 13 }}>{productName}</p>
      <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 400 }}>Connect this device</h1>
      <p style={{ color: "var(--attention)" }}>This authorization request is incomplete or invalid. Return to the app and try again.</p>
    </AuthorizationShell>
  }

  // No Home session yet: skip the LifeOS-branded landing entirely and go
  // straight to the Google account chooser, ephemeral-session-friendly (no
  // stale cross-app cookie assumed). The device app re-lands here afterward
  // with the exact same query string.
  const session = await auth()
  if (!session?.user?.email) {
    const params = new URLSearchParams({
      platform, device_name: deviceName, app_version: appVersion,
      redirect_uri: redirectUri, code_challenge: codeChallenge, state,
    })
    return <AuthorizationShell>
      <p style={{ margin: "0 0 8px", color: "var(--cognac)", fontSize: 13 }}>{productName}</p>
      <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 400 }}>Signing in…</h1>
      <AutoGoogleSignIn callbackUrl={`/device/authorize?${params.toString()}`} />
    </AuthorizationShell>
  }

  // Signed in: authorize immediately, server-side, and hand control back to
  // the app. No consent screen — the user already approved this exact grant
  // (Contacts only, revocable) inside the native app before Connect was tapped.
  const result = await authorizeDevice(
    { email: session.user.email, platform, displayName: deviceName, appVersion, redirectUri, codeChallenge },
    state,
  )
  if (!result.ok) {
    return <AuthorizationShell>
      <p style={{ margin: "0 0 8px", color: "var(--cognac)", fontSize: 13 }}>{productName}</p>
      <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 400 }}>Couldn't connect</h1>
      <p style={{ color: "var(--attention)" }}>{result.error}. Return to the app and try again, or contact support if this keeps happening.</p>
    </AuthorizationShell>
  }
  redirect(result.callbackUrl)
}

function AuthorizationShell({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)", display: "grid", placeItems: "center", padding: 24 }}>
    <section style={{ width: "min(100%, 520px)", background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: 16, boxShadow: "var(--shadow-lg)", padding: "32px 34px" }}>
      {children}
    </section>
  </main>
}
