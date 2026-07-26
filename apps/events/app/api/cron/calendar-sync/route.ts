import { NextRequest, NextResponse } from "next/server"
import { syncAllGoogleCalendars } from "@/server/domain/google-calendar"

// Auto-sync cron. Vercel Cron invokes this on a schedule and, when CRON_SECRET
// is set, sends it as `Authorization: Bearer <CRON_SECRET>`. We require that so
// the endpoint can't be triggered by anyone else (it runs a session-less sync
// with stored tokens). Give the sync room to page through calendars.
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  const authorized =
    req.headers.get("authorization") === `Bearer ${secret}` ||
    req.nextUrl.searchParams.get("secret") === secret
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await syncAllGoogleCalendars({})
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar auto-sync failed"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
