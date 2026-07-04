import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  if (process.env.DEV_BYPASS === "true") return NextResponse.next()
  if (req.auth) return NextResponse.next()

  const loginUrl = new URL("/login", req.url)
  loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
})

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
}