import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET() {
  const events = await db.event.findMany({
    include: { place: true, interactions: { include: { person: true } } },
    orderBy: { timestamp: "desc" },
  })
  return NextResponse.json(events)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, type, timestamp, placeId, notes, transcript, metadata } = body

  const event = await db.event.create({
    data: {
      name: name.trim(),
      type,
      timestamp: new Date(timestamp),
      placeId: placeId || null,
      notes: notes?.trim() || null,
      transcript: transcript?.trim() || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  })

  return NextResponse.json(event, { status: 201 })
}
