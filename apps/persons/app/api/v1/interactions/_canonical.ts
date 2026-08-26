import { NextRequest, NextResponse } from "next/server"

const SUNSET = "Thu, 05 Nov 2026 00:00:00 GMT"

/**
 * Forward legacy Persons reads to apps/api once LIFE_OS_API_URL is configured.
 * Until the API deployment exists, callers fall through to the local handler
 * so landing this compatibility code cannot create an outage.
 */
export async function forwardCanonicalStream(req: NextRequest, pathname: string) {
  const base = process.env.LIFE_OS_API_URL?.trim()
  if (!base) return null

  const target = new URL(pathname, base)
  target.search = req.nextUrl.search
  const headers = new Headers()
  for (const name of ["authorization", "x-api-key", "accept"]) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }

  try {
    const response = await fetch(target, { headers, cache: "no-store" })
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set("Deprecation", "true")
    responseHeaders.set("Sunset", SUNSET)
    responseHeaders.set("Link", `<${target.toString()}>; rel="canonical"`)
    return new NextResponse(response.body, { status: response.status, headers: responseHeaders })
  } catch (error) {
    console.error("Canonical API forwarding failed", { pathname, error })
    const response = NextResponse.json({ error: { code: "upstream_unavailable", message: "Canonical LifeOS API is unavailable" } }, { status: 502 })
    response.headers.set("Deprecation", "true")
    response.headers.set("Sunset", SUNSET)
    response.headers.set("Link", `<${target.toString()}>; rel="canonical"`)
    return response
  }
}
