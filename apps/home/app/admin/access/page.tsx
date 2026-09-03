import { db } from "@life-os/db"
import { loadAdminCapabilities, requireAdminCapability } from "@/lib/admin-access"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { redirect } from "next/navigation"
import { AccessControls } from "../AdminControls"
import { AdminChrome } from "../AdminChrome"

export const metadata = { title: "Access · Admin · LifeOS" }

export default async function AdminAccessPage() {
  const capabilities = await requireAdminCapability(cap => cap.access)
  if (!capabilities) redirect("/admin")
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")

  const [workspace, roles, permissions] = await Promise.all([
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        members: {
          where: { status: "active" },
          orderBy: { createdAt: "asc" },
          take: 500,
          select: {
            id: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                roles: { take: 100, select: { role: { select: { id: true, name: true } } } },
              },
            },
          },
        },
      },
    }),
    db.role.findMany({
      orderBy: { key: "asc" },
      take: 100,
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        permissions: { take: 500, select: { permission: { select: { id: true, scope: true, description: true } } } },
        _count: { select: { users: true } },
      },
    }),
    db.permission.findMany({ orderBy: { scope: "asc" }, take: 500, select: { id: true, scope: true, description: true } }),
  ])

  const accessUsers = workspace?.members.map(member => ({
    id: member.user.id,
    email: member.user.email,
    name: member.user.name,
    roles: member.user.roles.map(item => item.role),
  })) ?? []

  return (
    <AdminChrome tab="access" capabilities={capabilities}>
      <AccessControls
        roles={roles.map(role => ({
          ...role,
          permissions: role.permissions.map(item => item.permission),
          userCount: role._count.users,
        }))}
        users={accessUsers}
        permissions={permissions}
      />
    </AdminChrome>
  )
}
