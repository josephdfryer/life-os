import { db } from "@/lib/db"

export async function getWorkspaceId(email: string): Promise<string> {
  const member = await db.workspaceMember.findFirst({
    where: { user: { email }, status: "active" },
    select: { workspaceId: true },
    orderBy: { createdAt: "asc" },
  })
  return member?.workspaceId ?? "default-workspace"
}