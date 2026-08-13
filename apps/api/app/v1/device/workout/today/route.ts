import { NextRequest } from "next/server"
import { workoutTodayBundleContract } from "@life-os/contracts"
import { today } from "@life-os/level-up"
import { authorizeDeviceRequest } from "@/lib/device-auth"
import { errorResponse, handleRouteError } from "@/lib/respond"

// Accepts the requested program-day ID and current flare flags; defaults to
// the next scheduled active-program day. See
// docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md "Workout APIs".
export async function GET(request: NextRequest) {
  const auth = await authorizeDeviceRequest(request, "workout.read")
  if (!auth) return errorResponse(401, "unauthorized", "Device access token is invalid or expired")

  const { searchParams } = new URL(request.url)
  const programDayId = searchParams.get("programDayId")
  const flares = { knee: searchParams.get("knee") === "1", lumbar: searchParams.get("lumbar") === "1" }

  try {
    const bundle = await today(auth.workspaceId, { programDayId, flares })
    if (!bundle) return errorResponse(404, "not_found", "No active program day found")
    return Response.json(workoutTodayBundleContract.parse(bundle))
  } catch (error) {
    return handleRouteError(error)
  }
}
