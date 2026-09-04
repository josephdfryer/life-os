import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { loadBundle } from "@life-os/level-up"
import { COMBINE_GROUPS } from "@/lib/combine-catalog"
import { Mono } from "@/components/display"
import CombineFlow from "@/components/CombineFlow"
import WarmConcrete from "@/components/WarmConcrete"

export const dynamic = "force-dynamic"

export default async function CombinePage() {
  const access = await requireLevelUpAccess()
  if (!access) {
    return (
      <WarmConcrete>
        <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>
      </WarmConcrete>
    )
  }
  const { profile } = await loadBundle(access.workspaceId)
  return (
    <WarmConcrete>
      <div className="wrap">
        <div style={{ padding: "24px 0 0" }}>
          <Link href="/" className="mono mono-faint">← Card</Link>
        </div>
        <CombineFlow groups={COMBINE_GROUPS} defaultBodyweight={profile.bodyweightKg} />
      </div>
    </WarmConcrete>
  )
}
