import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { homeLoginRedirect } from "@life-os/auth"

export const dynamic = "force-dynamic"

// Login is centralized in the Home app. This satellite no longer has its own
// sign-in UI: it forwards unauthenticated users to Home, preserving where they
// were headed (callbackUrl) so Home can return them here after sign-in.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const { callbackUrl } = await searchParams
  const h = await headers()
  const host = h.get("host") ?? ""
  const proto = h.get("x-forwarded-proto") ?? "https"
  const origin = host ? `${proto}://${host}` : ""

  const target = homeLoginRedirect(callbackUrl, origin)
  if (target) redirect(target)

  // Local dev without a configured Home hub: nothing to render.
  return (
    <main style={{ padding: "48px", textAlign: "center", fontFamily: "system-ui" }}>
      Sign in from the Home app to continue.
    </main>
  )
}
