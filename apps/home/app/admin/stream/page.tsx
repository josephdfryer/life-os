import { redirect } from "next/navigation"
import { loadAdminCapabilities } from "@/lib/admin-access"
import StreamClient from "../../../components/StreamClient"
import { AdminChrome } from "../AdminChrome"

export const metadata = { title: "Stream · Admin · LifeOS" }

export default async function AdminStreamPage() {
  const capabilities = await loadAdminCapabilities()
  if (!capabilities) redirect("/login")

  return (
    <AdminChrome tab="stream" capabilities={capabilities} intro="Everything that has happened, in one chronological view.">
      <div style={{ marginTop: 28 }}>
        <StreamClient />
      </div>
    </AdminChrome>
  )
}
