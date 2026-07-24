import { auth } from "@/auth"
import { db } from "@/lib/db"
import { localReviewEnabled } from "@/lib/local-review"

export async function requireStuffAccess() {
  if (localReviewEnabled()) {
    const workspace = await db.workspace.findFirst({
      where: {
        status: "active",
        OR: [
          { ownerUserId: { not: null } },
          { members: { some: { status: "active" } } },
        ],
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
    where: { user: { email }, status: "active" },
    select: {
      workspaceId: true,
      user: { select: { id: true, personId: true, name: true, email: true } },
    },
  })

  return {
    workspaceId: member?.workspaceId ?? "default-workspace",
    user: member?.user ?? { id: "", personId: null, name: session.user?.name ?? null, email },
  }
}
