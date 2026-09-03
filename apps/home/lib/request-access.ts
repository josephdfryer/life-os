import { auth } from "@/auth"
import { db } from "@life-os/db"

export async function workspaceForHomeRequest() {
  const session = await auth()
  if (session?.user?.email) {
    const member = await db.workspaceMember.findFirst({
      where: { user: { email: session.user.email }, status: "active" },
      select: { workspaceId: true },
      orderBy: { createdAt: "asc" },
    })
    if (member?.workspaceId) return member.workspaceId

    // Local review / E2E hardening:
    // NextAuth may still produce a session object in dev/CI, but the
    // seeded DB might only contain the synthetic default-workspace owner.
    // Falling back prevents admin pages from redirecting to /login.
    if (process.env.NODE_ENV !== "production" && process.env.LIFE_OS_LOCAL_REVIEW === "1") {
      return "default-workspace"
    }

    return null
  }
  if (process.env.NODE_ENV !== "production" && process.env.LIFE_OS_LOCAL_REVIEW === "1") {
    return "default-workspace"
  }
  return null
}
