import { NextRequest, NextResponse } from "next/server"

/**
 * Oura redirects here after consent. The code never stays in the browser
 * longer than this request — Home posts it to the API, which stores
 * encrypted tokens and starts the 35-day backfill.
 */
export async function GET(request: NextRequest) {
  const denied = request.nextUrl.searchParams.get("error")
  if (denied) return NextResponse.redirect(new URL("/connections?oura=denied", request.url))

  const code = request.nextUrl.searchParams.get("code")?.trim() ?? ""
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? ""
  const scope = request.nextUrl.searchParams.get("scope")?.trim() ?? "daily"
  if (!code || !state) return NextResponse.redirect(new URL("/connections?oura=invalid", request.url))

  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) {
    return NextResponse.redirect(new URL("/connections?oura=not_configured", request.url))
  }

  try {
    const response = await fetch(new URL("/v1/connections/oura/callback", baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ code, state, scope }),
      cache: "no-store",
    })
    const body = await response.json() as { backfillError?: string | null; error?: { code?: string } }
    if (!response.ok) {
      const codeName = body.error?.code === "scope" ? "scope" : "callback_failed"
      return NextResponse.redirect(new URL(`/connections?oura=${codeName}`, request.url))
    }
    if (body.backfillError) {
      return NextResponse.redirect(new URL("/connections?oura=connected_sync_failed", request.url))
    }
    return NextResponse.redirect(new URL("/connections?oura=connected", request.url))
  } catch {
    return NextResponse.redirect(new URL("/connections?oura=unavailable", request.url))
  }
}
