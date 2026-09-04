import { redirect } from "next/navigation"
import { requireLevelUpAccess } from "@/lib/access"
import { Mono } from "@/components/display"
import SessionScreen from "@/components/workout/SessionScreen"
import WarmConcrete from "@/components/WarmConcrete"
import { loadWorkoutProfile, prepareDay } from "@life-os/level-up"

export const dynamic = "force-dynamic"

type Search = Promise<{
  session?: string
  started?: string
  day?: string
  knee?: string
  lumbar?: string
}>

export default async function SessionPage({ searchParams }: { searchParams: Search }) {
  const access = await requireLevelUpAccess()
  if (!access) {
    return (
      <WarmConcrete>
        <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>
      </WarmConcrete>
    )
  }

  const { session, started, day, knee, lumbar } = await searchParams
  if (!session || !day) redirect("/train")

  const flares = { knee: knee === "1", lumbar: lumbar === "1" }
  const [prepared, profile] = await Promise.all([
    prepareDay(access.workspaceId, day, flares),
    loadWorkoutProfile(access.workspaceId),
  ])
  if (!prepared) redirect("/train")

  return (
    <WarmConcrete>
      <SessionScreen
        sessionId={session}
        startedAt={started ?? new Date().toISOString()}
        dayName={prepared.dayName}
        entries={prepared.entries}
        unit={profile.unit}
        microPlates={profile.microPlates}
        bodyweightKg={profile.bodyweightKg}
      />
    </WarmConcrete>
  )
}
