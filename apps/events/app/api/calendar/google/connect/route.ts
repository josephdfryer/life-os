import { NextRequest, NextResponse } from "next/server"
import { lifeOsAppUrl } from "@life-os/auth"

export async function GET(req: NextRequest) {
  const homeUrl = lifeOsAppUrl("home", "http://localhost:3003")
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/admin/connections"
  const target = new URL("/admin/connections/google/calendar/connect", homeUrl)
  target.searchParams.set("returnTo", returnTo)
  return NextResponse.redirect(target)
}
