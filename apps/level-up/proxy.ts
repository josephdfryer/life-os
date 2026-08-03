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
  // The PWA install assets stay public. A manifest is fetched without
  // credentials by spec, so gating it behind auth silently drops standalone
  // display and the start URL at Add-to-Home-Screen time — and an app name and
  // an icon are nothing to protect.
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|manifest.webmanifest|apple-icon|icon).*)",
  ],
}
