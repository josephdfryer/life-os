import { workoutBodyMetricContract, contractIssues } from "@life-os/contracts"
import { logBodyMetric } from "@life-os/level-up"
import { authorizeDeviceRequest } from "@/lib/device-auth"
import { errorResponse, handleRouteError } from "@/lib/respond"

export async function POST(request: Request) {
  const auth = await authorizeDeviceRequest(request, "workout.write")
  if (!auth) return errorResponse(401, "unauthorized", "Device access token is invalid or expired")
  const parsed = workoutBodyMetricContract.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(400, "validation", "Invalid body metric payload", contractIssues(parsed.error))

  try {
    await logBodyMetric({ workspaceId: auth.workspaceId, ...parsed.data })
    return Response.json({ recordedAt: new Date().toISOString() })
  } catch (error) {
    return handleRouteError(error)
  }
}
