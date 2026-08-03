import { requireLevelUpAccess } from "@/lib/access"
import { Mono } from "@/components/display"
import StartSession from "@/components/workout/StartSession"
import { ensureSeeded, loadProgramDays } from "@/lib/workout/store"

export const dynamic = "force-dynamic"

export default async function TrainPage() {
  const access = await requireLevelUpAccess()
  if (!access) return <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>

  // First visit writes the default program; every visit after is a no-op.
  await ensureSeeded(access.workspaceId)
  const days = await loadProgramDays(access.workspaceId)

  return (
    <div className="wrap">
      <StartSession days={days} />
    </div>
  )
}
