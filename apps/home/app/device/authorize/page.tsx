import type { Metadata } from "next"
import { Suspense } from "react"

export const metadata: Metadata = { title: "Connect Life OS Companion" }

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

  return <AuthorizationShell>
        <p style={{ margin: "0 0 8px", color: "var(--cognac)", fontSize: 13 }}>Life OS Companion</p>
        <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 400 }}>Connect this device</h1>
        {valid ? <>
          <p style={{ color: "var(--ink-2)", lineHeight: 1.6 }}>
            <strong>{deviceName}</strong> will be allowed to send normalized records and connector health to this workspace.
            Raw databases, files, audio, health samples, and GPS pings stay on the device.
          </p>
          <ul style={{ color: "var(--ink-3)", lineHeight: 1.7, paddingLeft: 20 }}>
            <li>Platform: {platform === "macos" ? "Mac" : "iPhone"}</li>
            <li>App version: {appVersion}</li>
            <li>You can revoke access at any time.</li>
          </ul>
          <form method="post" action="/api/device/authorize" style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
            <input type="hidden" name="platform" value={platform} />
            <input type="hidden" name="deviceName" value={deviceName} />
            <input type="hidden" name="appVersion" value={appVersion} />
            <input type="hidden" name="redirectUri" value={redirectUri} />
            <input type="hidden" name="codeChallenge" value={codeChallenge} />
            <input type="hidden" name="state" value={state} />
            <button type="submit" style={{ border: 0, borderRadius: 999, background: "var(--cognac)", color: "white", padding: "10px 20px", font: "inherit", cursor: "pointer" }}>
              Connect device
            </button>
          </form>
        </> : <p style={{ color: "var(--attention)" }}>This authorization request is incomplete or invalid. Return to the Companion app and try again.</p>}
  </AuthorizationShell>
}

function AuthorizationShell({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)", display: "grid", placeItems: "center", padding: 24 }}>
    <section style={{ width: "min(100%, 520px)", background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: 16, boxShadow: "var(--shadow-lg)", padding: "32px 34px" }}>
      {children}
    </section>
  </main>
}
