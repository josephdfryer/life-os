import { db } from "@life-os/db"
import { requireAdminCapability } from "@/lib/admin-access"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { redirect } from "next/navigation"
import { AdminChrome } from "../AdminChrome"
import { AuditTable } from "../shared"

export const metadata = { title: "Audit log · Admin · LifeOS" }

export default async function AdminAuditPage() {
  const capabilities = await requireAdminCapability(cap => cap.audit)
  if (!capabilities) redirect("/admin")
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")

  const audit = await db.auditLog.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      action: true,
      targetType: true,
      targetId: true,
      actorLabel: true,
    },
  })

  return (
    <AdminChrome tab="audit" capabilities={capabilities}>
      <AuditTable rows={audit} />
    </AdminChrome>
  )
}
