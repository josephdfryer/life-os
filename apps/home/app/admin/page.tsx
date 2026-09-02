import { Suspense } from "react"
import { redirect } from "next/navigation"
import { loadAdminCapabilities } from "@/lib/admin-access"
import { AdminChrome, AdminFallback } from "./AdminChrome"
import { AdminOverview } from "./shared"

export const metadata = { title: "Admin · LifeOS" }

export default function AdminPage(props: { searchParams: Promise<{ tab?: string }> }) {
  return <Suspense fallback={<AdminFallback />}><AdminContent {...props} /></Suspense>
}

async function AdminContent({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const capabilities = await loadAdminCapabilities()
  if (!capabilities) redirect("/login")
  const { tab } = await searchParams
  if (tab === "system" || tab === "health" || tab === "streams") redirect("/admin/health")
  if (tab === "stream") redirect("/admin/stream")
  if (tab === "api-keys") redirect("/admin/api-keys")
  if (tab === "access") redirect("/admin/access")
  if (tab === "workspace") redirect("/admin/workspace")
  if (tab === "audit") redirect("/admin/audit")
  if (tab === "connections") redirect("/admin/connections")
  if (tab === "automation") redirect("/admin/automation")

  return (
    <AdminChrome tab="overview" capabilities={capabilities}>
      <AdminOverview capabilities={capabilities} />
    </AdminChrome>
  )
}
