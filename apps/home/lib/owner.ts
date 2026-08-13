import { auth } from "@/auth"
import { db } from "@life-os/db"

// The signed-in user if there is a session, otherwise the workspace's
// owner member (local-review mode has no session). Shared by anything that
// records or reads data against "the workspace owner's Person" — the
// evening/morning check-ins and Adaptive Day's capacity engine both need
// this exact resolution.
export async function resolveWorkspaceOwner(workspaceId: string) {
  const session = await auth()
  const owner = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email }, select: { id: true, personId: true } })
    : await db.user.findFirst({
        where: { workspaceMemberships: { some: { workspaceId, role: "owner", status: "active" } } },
        select: { id: true, personId: true },
      })
  return owner ?? null
}
