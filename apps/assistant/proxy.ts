import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  // Local auth bypass — see AGENTS.md "Local Development: Always Bypass Auth"
  const localBypass = process.env.NODE_ENV !== "production"
    && process.env.LIFE_OS_LOCAL_REVIEW === "1"
  if (localBypass) return NextResponse.next()

  if (req.auth) return NextResponse.next()

  const loginUrl = new URL("/login", req.url)
  loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
})

export const config = {
  matcher: [
    /*
     * Protect everything EXCEPT:
     *  - /api/auth/*           NextAuth callbacks
     *  - /api/webhook/*        Twilio (signature-validated in the handler)
     *  - /api/health           uptime checks
     *  - /login, Next internals
     */
    "/((?!api/auth|api/webhook|api/health|login|_next/static|_next/image|favicon.ico|.well-known/workflow/).*)",
  ],
}
