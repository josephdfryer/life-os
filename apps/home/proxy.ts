import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { isMarketingHost } from "@/lib/site"

export default auth((req) => {
  if (process.env.NODE_ENV !== "production" && process.env.LIFE_OS_LOCAL_REVIEW === "1") {
    return NextResponse.next()
  }

  // The apex domain's root page is the public marketing site — never gated
  // behind login. Everything else on that host (including any other path)
  // still requires auth like normal, so the dashboard can't leak through it.
  if (isMarketingHost(req.headers.get("host")) && req.nextUrl.pathname === "/") {
    return NextResponse.next()
  }

  if (req.auth) return NextResponse.next()

  const loginUrl = new URL("/login", req.url)
  loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
})

export const config = {
  // device/authorize is excluded because it does its own auth() check and
  // preserves the full PKCE query string via an in-page redirect straight to
  // Google — this blanket gate only forwards pathname, which would drop it.
  matcher: [
    "/((?!api/auth|login|privacy|terms|admin/connections/oura/callback|admin/connections/google/gmail/callback|admin/connections/google/calendar/callback|device/authorize|_next/static|_next/image|favicon.ico).*)",
  ],
}
