import { auth } from "@/auth"
import { db } from "@/lib/db"
import { localReviewEnabled } from "@/lib/local-review"

export type LevelUpAccess = {
  workspaceId: string
  user: { id: string; personId: string | null; name: string | null; email: string | null }
}

// Mirrors the access pattern used across Life OS satellites: fail closed, never
// silently default into the shared "default-workspace" (a cross-tenant leak the
// moment there's more than one user). Local review picks the first real
// workspace so the app is usable without the Home SSO hub running.
export async function requireLevelUpAccess(): Promise<LevelUpAccess | null> {
  if (localReviewEnabled()) {
    const workspace = await db.workspace.findFirst({
      where: {
        status: "active",
        OR: [{ ownerUserId: { not: null } }, { members: { some: { status: "active" } } }],
      },
      orderBy: [{ id: "asc" }],
      select: {
        id: true,
        ownerUser: { select: { id: true, personId: true, name: true, email: true } },
        members: {
          where: { status: "active" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { user: { select: { id: true, personId: true, name: true, email: true } } },
        },
      },
    })
    const user = workspace?.ownerUser ?? workspace?.members[0]?.user
    if (workspace) {
      return {
        workspaceId: workspace.id,
        user: user ?? { id: "local-review", personId: null, name: "Local reviewer", email: "local@life-os.test" },
      }
    }
  }

  const session = await auth()
  const email = session?.user?.email
  if (!email) return null

  const member = await db.workspaceMember.findFirst({
    where: { user: { email }, status: "active", workspace: { status: "active" } },
    select: {
      workspaceId: true,
      user: { select: { id: true, personId: true, name: true, email: true } },
    },
  })
  if (!member) return null
  return { workspaceId: member.workspaceId, user: member.user }
}
