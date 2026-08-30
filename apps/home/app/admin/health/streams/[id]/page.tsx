import { Suspense } from "react"
import { redirect } from "next/navigation"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { loadDataStreams } from "@/lib/load-data-streams"
import { loadStreamEvents } from "@/lib/load-system-health"
import { AdminChrome, AdminBreadcrumb } from "../../../AdminChrome"
import { StreamDetailPanel } from "../../../ConnectionHealthPanel"

export const metadata = { title: "Stream · Admin · LifeOS" }

export default function StreamDetailPage(props: { params: Promise<{ id: string }> }) {
  return (
    <AdminChrome tab="health">
      <Suspense fallback={<div className="stream-message">Loading stream…</div>}>
        <StreamDetailContent {...props} />
      </Suspense>
    </AdminChrome>
  )
}

async function StreamDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")
  const { id } = await params
  const streamId = decodeURIComponent(id)
  const streams = await loadDataStreams(workspaceId)
  const row = streams.rows.find(item => item.id === streamId)
  if (!row) {
    return (
      <>
        <AdminBreadcrumb items={[
          { href: "/admin/health", label: "System health" },
          { label: "Not found" },
        ]} />
        <div className="stream-message">That stream is not in this workspace.</div>
      </>
    )
  }
  const events = await loadStreamEvents(workspaceId, row.spec.graphSources)
  return <StreamDetailPanel row={row} events={events} />
}
