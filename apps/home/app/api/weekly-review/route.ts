import { NextResponse } from "next/server"
import { db } from "@life-os/db"
import { workspaceForHomeRequest } from "@/lib/request-access"

export async function POST(request: Request) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => null) as { action?: unknown; text?: unknown } | null
  if (body?.action === "feedback" && (body.text === "useful" || body.text === "not-useful")) {
    const note = await db.note.create({
      data: {
        workspaceId,
        type: "observation",
        content: `Weekly review feedback: ${body.text}`,
        timestamp: new Date(),
        metadata: JSON.stringify({ source: "weekly-review-feedback" }),
      },
      select: { id: true },
    })
    return NextResponse.json({ saved: true, noteId: note.id }, { status: 201 })
  }
  if (body?.action === "plan" && typeof body.text === "string" && body.text.trim()) {
    const plan = await db.plan.create({
      data: { workspaceId, text: body.text.trim(), status: "active", externalSource: "weekly-review" },
      select: { id: true },
    })
    return NextResponse.json({ saved: true, planId: plan.id }, { status: 201 })
  }
  return NextResponse.json({ error: "A valid feedback or Plan action is required" }, { status: 400 })
}
