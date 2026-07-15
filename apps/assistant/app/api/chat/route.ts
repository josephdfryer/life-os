import { NextRequest, NextResponse } from "next/server"
import { runAgent } from "@/lib/agent"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"

export const maxDuration = 300
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const access = await requireWorkspaceAccess()
    const from = `web:${access.email}`
    const messages = await db.assistantMessage.findMany({
      where: { workspaceId: access.workspaceId, from },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { id: true, role: true, content: true, createdAt: true },
    })
    return NextResponse.json({ messages: messages.reverse() })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(req: NextRequest) {
  let access
  try {
    access = await requireWorkspaceAccess()
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }

  const from = `web:${access.email}`
  const body = await req.json().catch(() => null)
  const message = typeof body?.message === "string" ? body.message.trim() : ""
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 })

  try {
    const reply = await runAgent({ channel: "web", from, userMessage: message, workspaceId: access.workspaceId })
    return NextResponse.json({ reply })
  } catch (error) {
    console.error("Chat agent failed:", error)
    return NextResponse.json({ error: "Agent failed — try again" }, { status: 500 })
  }
}
