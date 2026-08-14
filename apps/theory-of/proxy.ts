import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  // Local auth bypass — see AGENTS.md "Local Development: Always Bypass Auth".
  // LIFE_OS_LOCAL_REVIEW=1 is the standard flag; DEV_BYPASS=true kept for compat.
  const localBypass = process.env.NODE_ENV !== "production"
    && (process.env.LIFE_OS_LOCAL_REVIEW === "1" || process.env.DEV_BYPASS === "true")
  if (localBypass) return NextResponse.next()

  if (req.auth) return NextResponse.next()

  const loginUrl = new URL("/login", req.url)
  loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
})

export const config = {
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|.well-known/workflow/).*)",
  ],
}
