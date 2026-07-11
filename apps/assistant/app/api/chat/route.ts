import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { runAgent } from "@/lib/agent"
import { db } from "@/lib/db"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const WORKSPACE_ID = process.env.LIFE_OS_WORKSPACE_ID ?? "default-workspace"

async function chatIdentity(): Promise<string | null> {
  if (process.env.NODE_ENV !== "production" && process.env.LIFE_OS_LOCAL_REVIEW === "1") {
    return "web:local"
  }
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  return email ? `web:${email}` : null
}

export async function GET() {
  const from = await chatIdentity()
  if (!from) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const messages = await db.assistantMessage.findMany({
    where: { workspaceId: WORKSPACE_ID, from },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, role: true, content: true, createdAt: true },
  })
  return NextResponse.json({ messages: messages.reverse() })
}

export async function POST(req: NextRequest) {
  const from = await chatIdentity()
  if (!from) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => null)
  const message = typeof body?.message === "string" ? body.message.trim() : ""
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 })

  try {
    const reply = await runAgent({ channel: "web", from, userMessage: message })
    return NextResponse.json({ reply })
  } catch (error) {
    console.error("Chat agent failed:", error)
    return NextResponse.json({ error: "Agent failed — try again" }, { status: 500 })
  }
}
