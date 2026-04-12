import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  // Already authenticated — let through
  if (req.auth) return NextResponse.next()

  // Not authenticated — redirect to login
  const loginUrl = new URL("/login", req.url)
  loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
})

export const config = {
  matcher: [
    /*
     * Protect everything EXCEPT:
     *  - /api/auth/*       NextAuth callbacks
     *  - /api/v1/*         API key authenticated (machine-to-machine)
     *  - /login            Login page itself
     *  - /_next/*          Next.js internals
     *  - /favicon.ico
     */
    "/((?!api/auth|api/v1|login|_next/static|_next/image|favicon.ico).*)",
  ],
}
