import { NextRequest, NextResponse } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { auditLogList } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"
import { toLegacyAuditLogResponse } from "@/server/api/audit-log-compat"
import { forwardCanonicalStream } from "../interactions/_canonical"

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "audit.read")
  if (!auth) return unauthorized()

  const { searchParams } = new URL(req.url)
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)))
  const action = searchParams.get("action")
  const actorType = searchParams.get("actorType")
  const compatibilityUrl = new URL(req.url)
  compatibilityUrl.searchParams.set("limit", String(limit))
  const forwarded = await forwardCanonicalStream(
    new NextRequest(compatibilityUrl, { headers: req.headers }),
    "/v1/audit-log",
  )
  if (forwarded) {
    if (!forwarded.ok) return forwarded
    try {
      const headers = new Headers(forwarded.headers)
      headers.delete("content-length")
      headers.delete("content-encoding")
      return NextResponse.json(
        toLegacyAuditLogResponse(await forwarded.json(), auth.workspaceId),
        { status: forwarded.status, headers },
      )
    } catch (error) {
      console.error("Canonical audit-log response was incompatible", error)
      return NextResponse.json(
        { error: { code: "upstream_invalid_response", message: "Canonical Life OS API returned an invalid audit-log response" } },
        { status: 502 },
      )
    }
  }

  try {
    const entries = await auditLogList({ workspaceId: auth.workspaceId, limit, action, actorType })
    return NextResponse.json({ data: entries, limit })
  } catch (error) {
    return handleRouteError(error)
  }
}
