import { Suspense } from "react"
import { redirect } from "next/navigation"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { loadDataStreams } from "@/lib/load-data-streams"
import { loadSystemHealth } from "@/lib/load-system-health"
import { AdminChrome } from "../AdminChrome"
import { ConnectionHealthPanel } from "../ConnectionHealthPanel"

export const metadata = { title: "System health · Admin · LifeOS" }

export default function ConnectionHealthPage() {
  return (
    <AdminChrome tab="health">
      <Suspense fallback={<div className="stream-message">Loading system health…</div>}>
        <HealthContent />
      </Suspense>
    </AdminChrome>
  )
}

async function HealthContent() {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")
  const [streams, spine] = await Promise.all([
    loadDataStreams(workspaceId),
    loadSystemHealth(workspaceId),
  ])
  return <ConnectionHealthPanel streams={streams} spine={spine} />
}
