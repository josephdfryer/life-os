import { db } from "@life-os/db"
import { requireAdminCapability } from "@/lib/admin-access"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { redirect } from "next/navigation"
import { ApprovedEmailControls, WorkspacesControls } from "../AdminControls"
import { AdminChrome } from "../AdminChrome"
import { WorkspacePanel } from "../shared"

export const metadata = { title: "Workspace · Admin · LifeOS" }

export default async function AdminWorkspacePage() {
  const capabilities = await requireAdminCapability(cap => cap.workspace)
  if (!capabilities) redirect("/admin")
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")

  const [workspace, approvedEmails, inviteRoles, allWorkspaces] = await Promise.all([
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        members: {
          where: { status: "active" },
          orderBy: { createdAt: "asc" },
          take: 500,
          select: {
            id: true,
            role: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    }),
    db.approvedEmail.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, email: true, status: true, workspaceId: true, createdAt: true, role: { select: { id: true, key: true, name: true, description: true } } },
    }),
    db.role.findMany({
      where: { key: { notIn: ["owner", "automation"] } },
      orderBy: { name: "asc" },
      take: 100,
      select: { id: true, key: true, name: true, description: true },
    }),
    workspaceId === "default-workspace" && capabilities.crossTenantWorkspaces
      ? db.workspace.findMany({
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            createdAt: true,
            ownerUser: { select: { email: true } },
            _count: { select: { members: true, approvedEmails: true } },
          },
        })
      : Promise.resolve([]),
  ])

  return (
    <AdminChrome tab="workspace" capabilities={capabilities}>
      <WorkspacePanel workspace={workspace} />
      <ApprovedEmailControls rows={approvedEmails.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }))} roles={inviteRoles} />
      {capabilities.crossTenantWorkspaces && (
        <WorkspacesControls rows={allWorkspaces.map(row => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          ownerEmail: row.ownerUser?.email ?? null,
          memberCount: row._count.members,
          approvedEmailCount: row._count.approvedEmails,
          isDefault: row.id === "default-workspace",
        }))} />
      )}
    </AdminChrome>
  )
}
