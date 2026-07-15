import { auth } from "@/auth"
import { db } from "@/lib/db"

export class AccessError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "AccessError"
    this.status = status
  }
}

export type WorkspaceAccess = { userId: string; email: string; workspaceId: string }

// Resolves the authenticated caller's own workspace from their session —
// never a hardcoded/default workspace. Mirrors the membership-resolution
// rules in apps/persons/server/domain/access.ts: disabled users and
// unrecognized emails are rejected, and an ambiguous (multi-workspace) user
// must be handled explicitly rather than defaulting to "first membership".
export async function requireWorkspaceAccess(): Promise<WorkspaceAccess> {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) throw new AccessError(401, "Unauthorized")

  const user = await db.user.findUnique({ where: { email }, select: { id: true, status: true } })
  if (!user || user.status !== "active") throw new AccessError(403, "Account is disabled or unknown")

  const memberships = await db.workspaceMember.findMany({
    where: { userId: user.id, status: "active", workspace: { status: "active" } },
    select: { workspaceId: true },
    orderBy: { createdAt: "asc" },
  })
  if (memberships.length === 0) throw new AccessError(403, "No active workspace membership")
  if (memberships.length > 1) throw new AccessError(400, "Multiple workspace memberships; workspace must be specified explicitly")

  return { userId: user.id, email, workspaceId: memberships[0].workspaceId }
}

export function accessErrorResponse(error: unknown) {
  if (error instanceof AccessError) {
    return { error: error.message, status: error.status }
  }
  return { error: error instanceof Error ? error.message : "Unexpected error", status: 500 }
}
