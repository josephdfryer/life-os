import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { homeLoginRedirect } from "@life-os/auth"

export const dynamic = "force-dynamic"

// Sign-in is centralized in the Home app. Forward unauthenticated users there,
// preserving where they were headed so Home can return them after sign-in.
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

  return (
    <main style={{ padding: "48px", textAlign: "center", fontFamily: "system-ui", color: "#E8E2D6", background: "#1E1C18", minHeight: "100vh" }}>
      Sign in from the Home app to continue.
    </main>
  )
}
