"use server"

import { revalidatePath } from "next/cache"
import { requireLevelUpAccess } from "@/lib/access"
import * as commands from "@life-os/level-up"
import type { LoggedSet, LogSetInput, StartedSession } from "@life-os/level-up"

// ─────────────────────────────────────────────
// Thin "use server" wrappers. All behavior lives in @life-os/level-up so the
// web app and native device ingestion call identical commands — see
// docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md. This file only resolves the
// session's workspace and triggers the page revalidation a Server Action
// caller expects.
// ─────────────────────────────────────────────

async function ws() {
  const access = await requireLevelUpAccess()
  if (!access) throw new Error("No Level Up workspace access")
  return access.workspaceId
}

export async function startSession(input: {
  programDayId: string | null
  kneeFlare: boolean
  lumbarFlare: boolean
}): Promise<StartedSession> {
  const workspaceId = await ws()
  return commands.startSession({ workspaceId, ...input })
}

export async function endSession(sessionId: string) {
  const workspaceId = await ws()
  await commands.completeSession({ workspaceId, sessionId })
  revalidatePath("/train")
}

export type { LogSetInput, LoggedSet }

export async function logSet(input: Omit<LogSetInput, "workspaceId">): Promise<LoggedSet> {
  const workspaceId = await ws()
  return commands.logSet({ workspaceId, ...input })
}

export async function logBodyMetric(input: {
  weightKg: number | null
  bodyFatPct: number | null
  musclePct: number | null
}) {
  const workspaceId = await ws()
  await commands.logBodyMetric({ workspaceId, ...input })
  revalidatePath("/body")
}

export async function saveUnitPreference(input: { unit: "lb" | "kg"; microPlates: boolean }) {
  const workspaceId = await ws()
  await commands.saveUnitPreference({ workspaceId, ...input })
  revalidatePath("/train")
}
