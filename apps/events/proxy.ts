import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { localReviewEnabled } from "@/lib/local-review"

export default auth((req) => {
  if (localReviewEnabled()) return NextResponse.next()
  if (req.auth) return NextResponse.next()

  const loginUrl = new URL("/login", req.url)
  loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
})

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
}
