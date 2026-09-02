import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json(
    { error: { code: "moved", message: "Connect Granola at Home → Admin → Connections." } },
    { status: 410 },
  )
}
