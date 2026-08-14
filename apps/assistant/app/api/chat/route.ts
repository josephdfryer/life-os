import { NextRequest, NextResponse } from "next/server"
import { runAgent } from "@/lib/agent"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"
import { chatMessageContract, contractIssues } from "@life-os/contracts"
import { assertWorkspaceFiles } from "@life-os/files"

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
      select: { id: true, role: true, content: true, createdAt: true, metadata: true },
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
  const parsed = chatMessageContract.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid message", issues: contractIssues(parsed.error) }, { status: 400 })
  }
  const { message } = parsed.data

  try {
    const fileIds = await assertWorkspaceFiles(parsed.data.fileIds, access.workspaceId)
    const result = await runAgent({ channel: "web", from, userMessage: message, workspaceId: access.workspaceId, fileIds })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Chat agent failed:", error)
    return NextResponse.json({ error: "Agent failed — try again" }, { status: 500 })
  }
}
