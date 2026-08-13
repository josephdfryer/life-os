import { workoutCompleteSessionContract, contractIssues } from "@life-os/contracts"
import { completeSession } from "@life-os/level-up"
import { authorizeDeviceRequest } from "@/lib/device-auth"
import { errorResponse, handleRouteError } from "@/lib/respond"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeDeviceRequest(request, "workout.write")
  if (!auth) return errorResponse(401, "unauthorized", "Device access token is invalid or expired")
  const { id: sessionId } = await context.params
  const parsed = workoutCompleteSessionContract.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(400, "validation", "Invalid session completion payload", contractIssues(parsed.error))
  if (parsed.data.sessionId !== sessionId) return errorResponse(400, "validation", "Body sessionId must match the URL")

  try {
    await completeSession({ workspaceId: auth.workspaceId, sessionId, sessionRpe: parsed.data.sessionRpe ?? null })
    return Response.json({ completedAt: new Date().toISOString() })
  } catch (error) {
    return handleRouteError(error)
  }
}
