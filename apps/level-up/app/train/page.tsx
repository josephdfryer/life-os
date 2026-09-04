import { requireLevelUpAccess } from "@/lib/access"
import { Mono } from "@/components/display"
import StartSession from "@/components/workout/StartSession"
import WarmConcrete from "@/components/WarmConcrete"
import { ensureSeeded, loadProgramDays } from "@life-os/level-up"

export const dynamic = "force-dynamic"

export default async function TrainPage() {
  const access = await requireLevelUpAccess()
  if (!access) {
    return (
      <WarmConcrete>
        <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>
      </WarmConcrete>
    )
  }

  // First visit writes the default program; every visit after is a no-op.
  await ensureSeeded(access.workspaceId)
  const days = await loadProgramDays(access.workspaceId)

  return (
    <WarmConcrete>
      <div className="wrap">
        <StartSession days={days} />
      </div>
    </WarmConcrete>
  )
}
