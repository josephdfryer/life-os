import { NextRequest, NextResponse } from "next/server"
import { syncAllGranolaConnections } from "@/server/domain/granola"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncAllGranolaConnections()) })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Granola sync failed" }, { status: 500 })
  }
}
