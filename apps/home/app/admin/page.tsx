import { Suspense } from "react"
import { redirect } from "next/navigation"
import { loadAdminCapabilities } from "@/lib/admin-access"
import { AdminChrome, AdminFallback } from "./AdminChrome"
import { AdminOverview } from "./shared"

export const metadata = { title: "Admin · LifeOS" }

export default function AdminPage() {
  return <Suspense fallback={<AdminFallback />}><AdminContent /></Suspense>
}

async function AdminContent() {
  const capabilities = await loadAdminCapabilities()
  if (!capabilities) redirect("/login")

  return (
    <AdminChrome tab="overview" capabilities={capabilities}>
      <AdminOverview capabilities={capabilities} />
    </AdminChrome>
  )
}
