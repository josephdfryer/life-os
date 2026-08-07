import { NextResponse } from "next/server"

// apps/api has no UI — this is a bare health/identity check, useful for
// confirming a deploy landed and for uptime monitoring.
export async function GET() {
  return NextResponse.json({ service: "life-os-api", status: "ok" })
}
