import { loadAdminCapabilities } from "@/lib/admin-access"
import { redirect } from "next/navigation"
import { ConnectionsClient } from "./ConnectionsClient"
import { AdminChrome } from "../AdminChrome"

export const metadata = { title: "Connections · Admin · LifeOS" }

export default async function AdminConnectionsPage() {
  const capabilities = await loadAdminCapabilities()
  if (!capabilities) redirect("/login")

  return (
    <AdminChrome
      tab="connections"
      capabilities={capabilities}
      intro="Connect or reconnect every account here. Last data, collector freshness, and stream status live in system health."
    >
      <ConnectionsClient />
    </AdminChrome>
  )
}
