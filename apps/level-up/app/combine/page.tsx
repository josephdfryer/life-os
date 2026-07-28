import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { loadBundle } from "@/lib/store"
import { COMBINE_GROUPS } from "@/lib/combine-catalog"
import { Mono } from "@/components/display"
import CombineFlow from "@/components/CombineFlow"

export const dynamic = "force-dynamic"

export default async function CombinePage() {
  const access = await requireLevelUpAccess()
  if (!access) {
    return <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>
  }
  const { profile } = await loadBundle(access.workspaceId)
  return (
    <div className="wrap">
      <div style={{ padding: "24px 0 0" }}>
        <Link href="/" className="mono mono-faint">← Card</Link>
      </div>
      <CombineFlow groups={COMBINE_GROUPS} defaultBodyweight={profile.bodyweightKg} />
    </div>
  )
}
