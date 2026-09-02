import { Suspense } from "react"
import { requireAdminCapability } from "@/lib/admin-access"
import { redirect } from "next/navigation"
import { AdminChrome, AdminFallback } from "../AdminChrome"
import { AutomationPanel } from "./AutomationPanel"

export const metadata = { title: "Automation · Admin · LifeOS" }

export default async function AdminAutomationPage() {
  const capabilities = await requireAdminCapability(cap => cap.automation)
  if (!capabilities) redirect("/admin")

  return (
    <Suspense fallback={<AdminFallback />}>
      <AdminChrome
        tab="automation"
        capabilities={capabilities}
        intro="Rules decide when to act. Every action carries its own safety boundary, and the executor—not AI—decides what may change."
      >
        <AutomationPanel />
      </AdminChrome>
    </Suspense>
  )
}
