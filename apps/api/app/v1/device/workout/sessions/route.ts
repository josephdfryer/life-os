import { workoutStartSessionContract, workoutSessionResultContract, contractIssues } from "@life-os/contracts"
import { startSession, neutralReadinessSnapshot } from "@life-os/level-up"
import { authorizeDeviceRequest } from "@/lib/device-auth"
import { errorResponse, handleRouteError } from "@/lib/respond"

// Freezes the readiness snapshot the client was shown on the today bundle at
// session start — see docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md "Readiness
// provenance". Idempotent on sourceId: replaying the same ID with identical
// content returns the existing session; different content is a 409 conflict.
export async function POST(request: Request) {
  const auth = await authorizeDeviceRequest(request, "workout.write")
  if (!auth) return errorResponse(401, "unauthorized", "Device access token is invalid or expired")
  const parsed = workoutStartSessionContract.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(400, "validation", "Invalid session start payload", contractIssues(parsed.error))

  try {
    const result = await startSession({
      workspaceId: auth.workspaceId,
      programDayId: parsed.data.programDayId,
      kneeFlare: parsed.data.kneeFlare,
      lumbarFlare: parsed.data.lumbarFlare,
      source: parsed.data.sourceId ? "device" : null,
      sourceId: parsed.data.sourceId ?? null,
      readiness: neutralReadinessSnapshot(new Date().toISOString().slice(0, 10)),
    })
    return Response.json(workoutSessionResultContract.parse(result))
  } catch (error) {
    return handleRouteError(error)
  }
}
