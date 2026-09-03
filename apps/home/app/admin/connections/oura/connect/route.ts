import { NextRequest, NextResponse } from "next/server"
import { resolveProxyContext } from "@/lib/life-os-api-proxy"

/**
 * Browser entry for Oura OAuth. Asks the API for a signed authorize URL
 * (daily scope only) and sends the user to cloud.ouraring.com.
 */
export async function GET(request: NextRequest) {
  const context = await resolveProxyContext({
    notConfiguredCode: "connections_not_configured",
    notConfiguredMessage: "The shared connections service is not configured yet.",
    unavailableCode: "connections_unavailable",
    unavailableMessage: "The shared connections service is temporarily unavailable.",
  })
  if (!context.ok) {
    if (context.response.status === 401) return NextResponse.redirect(new URL("/login", request.url))
    return NextResponse.redirect(new URL("/admin/connections?oura=not_configured", request.url))
  }

  try {
    const target = new URL("/v1/connections/oura/authorize", context.baseUrl)
    target.searchParams.set("returnTo", "/admin/connections")
    const response = await fetch(target, {
      headers: { accept: "application/json", "x-api-key": context.apiKey, "x-workspace-override": context.workspaceId },
      cache: "no-store",
    })
    const body = await response.json() as { url?: string }
    if (!response.ok || !body.url) {
      return NextResponse.redirect(new URL("/admin/connections?oura=authorize_failed", request.url))
    }
    return NextResponse.redirect(body.url)
  } catch {
    return NextResponse.redirect(new URL("/admin/connections?oura=unavailable", request.url))
  }
}
