import { NextRequest } from "next/server"
import { db } from "@life-os/db"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse } from "@/lib/respond"

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, "devices.read")
  if (!auth) return unauthorizedResponse()
  const { searchParams } = new URL(request.url)
  const requestedLimit = Number(searchParams.get("limit") ?? 50)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50
  const cursor = decodeCursor(searchParams.get("cursor"))
  const devices = await db.device.findMany({
    where: {
      workspaceId: auth.workspaceId,
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
    select: { id: true, platform: true, displayName: true, appVersion: true, createdAt: true, lastSeenAt: true, revokedAt: true, sources: { orderBy: { source: "asc" }, select: { source: true, enabled: true, permissionStatus: true, healthStatus: true, lastSuccessAt: true, lastErrorCode: true, schemaVersion: true } } },
  })
  const hasMore = devices.length > limit
  const data = devices.slice(0, limit)
  const last = data.at(-1)
  return Response.json({ data, hasMore, limit, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null })
}

function encodeCursor(createdAt: Date, id: string) { return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url") }
function decodeCursor(raw: string | null): { createdAt: Date; id: string } | null {
  if (!raw) return null
  try { const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown }; const createdAt = new Date(String(value.createdAt)); return typeof value.id === "string" && value.id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id: value.id } : null } catch { return null }
}
