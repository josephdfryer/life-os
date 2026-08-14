import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { getWorkspaceId } from "@/lib/workspace"
import { granolaStatus } from "@/server/domain/granola"
import GranolaSettingsClient from "@/components/settings/GranolaSettingsClient"

export const dynamic = "force-dynamic"

export default async function GranolaSettingsPage() {
  const session = await auth()
  if (!session?.user?.email) redirect("/login")
  const workspaceId = await getWorkspaceId(session.user.email)
  const status = await granolaStatus(workspaceId)
  return (
    <div style={{ maxWidth: "760px", margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ marginBottom: "28px" }}>
        <Link href="/connections" style={{ display: "inline-block", marginBottom: 12, color: "var(--ink-3)", fontSize: 12, textDecoration: "none" }}>← Connections</Link>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "30px", fontWeight: 500, letterSpacing: "-0.02em", margin: "0 0 7px" }}>Granola meetings</h1>
        <p style={{ margin: 0, color: "var(--ink-3)", fontSize: "13px" }}>Bring meeting evidence into Events, People, and Groups without creating a separate silo.</p>
      </div>
      <GranolaSettingsClient initialStatus={JSON.parse(JSON.stringify(status))} />
    </div>
  )
}
