import { NextRequest, NextResponse } from "next/server"

/**
 * Browser entry for Oura OAuth. Asks the API for a signed authorize URL
 * (daily scope only) and sends the user to cloud.ouraring.com.
 */
export async function GET(request: NextRequest) {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) {
    return NextResponse.redirect(new URL("/connections?oura=not_configured", request.url))
  }

  try {
    const target = new URL("/v1/connections/oura/authorize", baseUrl)
    target.searchParams.set("returnTo", "/connections")
    const response = await fetch(target, {
      headers: { accept: "application/json", "x-api-key": apiKey },
      cache: "no-store",
    })
    const body = await response.json() as { url?: string; error?: { message?: string } }
    if (!response.ok || !body.url) {
      return NextResponse.redirect(new URL("/connections?oura=authorize_failed", request.url))
    }
    return NextResponse.redirect(body.url)
  } catch {
    return NextResponse.redirect(new URL("/connections?oura=unavailable", request.url))
  }
}
