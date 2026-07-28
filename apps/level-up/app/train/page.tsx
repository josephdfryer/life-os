import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { loadBundle } from "@/lib/store"
import { EXERCISE_CATALOG } from "@/lib/engine"
import { Mono } from "@/components/display"
import TrainLogger from "@/components/TrainLogger"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function TrainPage() {
  const access = await requireLevelUpAccess()
  if (!access) return <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>
  const [{ profile }, recentSets] = await Promise.all([
    loadBundle(access.workspaceId),
    db.levelUpTrainingSet.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { performedAt: "desc" },
      distinct: ["exerciseKey"],
      select: { exerciseKey: true, reps: true, loadKg: true },
    }),
  ])
  const exercises = Object.values(EXERCISE_CATALOG).map((e) => ({ key: e.key, label: e.label, hasNorm: !!e.norm }))
  return (
    <div className="wrap">
      <div className="train-back-link">
        <Link href="/">← Player card</Link>
      </div>
      <TrainLogger exercises={exercises} defaultBodyweight={profile.bodyweightKg} previousSets={recentSets} />
    </div>
  )
}
