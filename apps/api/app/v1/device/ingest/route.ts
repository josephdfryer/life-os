import { deviceIngestBatchContract, deviceIngestResultContract, contractIssues } from "@life-os/contracts"
import { authorizeDeviceRequest } from "@/lib/device-auth"
import { ingestDeviceItem } from "@/lib/device-ingest"
import { errorResponse } from "@/lib/respond"

export async function POST(request: Request) {
  const auth = await authorizeDeviceRequest(request, "device.ingest")
  if (!auth) return errorResponse(401, "unauthorized", "Device access token is invalid or expired")
  const parsed = deviceIngestBatchContract.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(400, "validation", "Invalid device ingest batch", contractIssues(parsed.error))
  if (parsed.data.items.some(item => item.deviceId !== auth.deviceId)) {
    return errorResponse(403, "device_mismatch", "Every item must belong to the authenticated device")
  }

  // Deliberately sequential: request order is the ordering guarantee within a
  // source. Per-item receipts make partial failures safe to replay.
  const results = []
  for (const item of parsed.data.items) results.push(await ingestDeviceItem(item, auth.workspaceId))
  return Response.json({ batchId: parsed.data.batchId, results: results.map(result => deviceIngestResultContract.parse(result)) })
}
