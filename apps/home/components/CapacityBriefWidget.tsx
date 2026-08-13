import { getOrGenerateTodaysBrief, getAdaptiveDayBriefForDay } from "@life-os/intelligence"
import { resolveWorkspaceOwner } from "@/lib/owner"
import { dayKey } from "@/lib/daily"
import CapacityBriefCards, { type SerializedBrief } from "./CapacityBriefCards"

type RawBrief = NonNullable<Awaited<ReturnType<typeof getOrGenerateTodaysBrief>>>

// Dates don't cross the server/client boundary as Date objects in this
// codebase's convention (see ReconciliationWidget -> ReconciliationCards) —
// stringify explicitly rather than rely on RSC's Date serialization.
function serializeBrief(brief: RawBrief): SerializedBrief {
  return {
    ...brief,
    generatedAt: brief.generatedAt.toISOString(),
    createdAt: brief.createdAt.toISOString(),
    updatedAt: brief.updatedAt.toISOString(),
    interventions: brief.interventions.map(iv => ({
      ...iv,
      createdAt: iv.createdAt.toISOString(),
      outcomes: iv.outcomes.map(outcome => ({ ...outcome, createdAt: outcome.createdAt.toISOString() })),
    })),
  }
}

// Fixed slot directly below Quick Capture and the day selector — same
// mechanism ReconciliationWidget occupies (see docs/ADAPTIVE_DAY_PLAN.md
// §4), not the draggable CustomizableWidgetGrid. Deliberately not "use
// cache": getOrGenerateTodaysBrief can write (lazily generating a brief),
// and its own day+rulesVersion idempotency check is what actually prevents
// duplicate generation — a render cache on top would just be confusing,
// not necessary.
export default async function CapacityBriefWidget({ workspaceId, day, tz }: { workspaceId: string; day: string; tz: string }) {
  const isToday = day === dayKey(new Date(), tz)

  if (!isToday) {
    const brief = await getAdaptiveDayBriefForDay(workspaceId, day)
    if (!brief) return null
    return <CapacityBriefCards brief={serializeBrief(brief)} isToday={false} timezone={tz} />
  }

  const owner = await resolveWorkspaceOwner(workspaceId)
  const brief = await getOrGenerateTodaysBrief(workspaceId, tz, owner?.personId ?? null, { type: "system", workspaceId })
  if (!brief) return null
  return <CapacityBriefCards brief={serializeBrief(brief)} isToday timezone={tz} />
}
