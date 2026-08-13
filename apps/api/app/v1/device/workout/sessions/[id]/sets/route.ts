import { workoutLogSetContract, workoutLoggedSetContract, contractIssues } from "@life-os/contracts"
import { logSet } from "@life-os/level-up"
import { authorizeDeviceRequest } from "@/lib/device-auth"
import { errorResponse, handleRouteError } from "@/lib/respond"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeDeviceRequest(request, "workout.write")
  if (!auth) return errorResponse(401, "unauthorized", "Device access token is invalid or expired")
  const { id: sessionId } = await context.params
  const parsed = workoutLogSetContract.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(400, "validation", "Invalid set payload", contractIssues(parsed.error))
  if (parsed.data.sessionId !== sessionId) return errorResponse(400, "validation", "Body sessionId must match the URL")

  try {
    const result = await logSet({
      workspaceId: auth.workspaceId,
      sessionId,
      exerciseId: parsed.data.exerciseId,
      exerciseKey: parsed.data.exerciseKey,
      catalogKey: parsed.data.catalogKey,
      setIndex: parsed.data.setIndex,
      reps: parsed.data.reps,
      loadKg: parsed.data.loadKg,
      durationSec: parsed.data.durationSec,
      isBodyweight: parsed.data.isBodyweight,
      bodyweightKg: parsed.data.bodyweightKg,
      source: parsed.data.sourceId ? "device" : null,
      sourceId: parsed.data.sourceId ?? null,
    })
    return Response.json(workoutLoggedSetContract.parse(result))
  } catch (error) {
    return handleRouteError(error)
  }
}
