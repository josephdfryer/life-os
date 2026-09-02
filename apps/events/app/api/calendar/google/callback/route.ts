import { NextRequest, NextResponse } from "next/server"
import { lifeOsAppUrl } from "@life-os/auth"

export async function GET(request: NextRequest) {
  const homeUrl = lifeOsAppUrl("home", "http://localhost:3003")
  const query = request.nextUrl.search
  return NextResponse.redirect(`${homeUrl}/admin/connections/google/calendar/callback${query}`)
}
