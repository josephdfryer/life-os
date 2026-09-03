import { db } from "@life-os/db"
import { requireAdminCapability } from "@/lib/admin-access"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { redirect } from "next/navigation"
import { ApiKeyControls } from "../AdminControls"
import { AdminChrome } from "../AdminChrome"

export const metadata = { title: "API keys · Admin · LifeOS" }

export default async function AdminApiKeysPage() {
  const capabilities = await requireAdminCapability(cap => cap.apiKeys)
  if (!capabilities) redirect("/admin")
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")

  const [apiKeys, permissions] = await Promise.all([
    db.apiKey.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        status: true,
        lastUsedAt: true,
        scopes: { take: 500, select: { scope: true } },
      },
    }),
    db.permission.findMany({ orderBy: { scope: "asc" }, take: 500, select: { id: true, scope: true, description: true } }),
  ])

  return (
    <AdminChrome tab="api-keys" capabilities={capabilities}>
      <ApiKeyControls
        apiKeys={apiKeys.map(key => ({
          ...key,
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          scopes: key.scopes.map(scope => scope.scope),
        }))}
        permissions={permissions}
      />
    </AdminChrome>
  )
}
