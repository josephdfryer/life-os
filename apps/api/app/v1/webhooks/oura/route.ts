import { NextRequest, NextResponse } from "next/server"
import { errorResponse, handleRouteError } from "@/lib/respond"
import { OuraError, ouraWebhookVerificationToken, verifyOuraWebhookSignature } from "@/lib/oura"
import { ingestOuraWebhookDocument, type OuraConnectionRow } from "@/lib/oura-ingest"

/**
 * Oura signed webhooks. GET is the subscription handshake (echo challenge).
 * POST is a thin event: fetch the changed daily document and rewrite that
 * source=oura day. No API key — authenticity is the HMAC + verification token.
 *
 *   GET  /v1/webhooks/oura?verification_token=&challenge=
 *   POST /v1/webhooks/oura
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("verification_token")
  const challenge = req.nextUrl.searchParams.get("challenge")
  const expected = ouraWebhookVerificationToken()
  if (!expected || !token || token !== expected || !challenge) {
    return errorResponse(401, "unauthorized", "Invalid Oura webhook verification")
  }
  return NextResponse.json({ challenge })
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text()
    const signature = req.headers.get("x-oura-signature")
    const timestamp = req.headers.get("x-oura-timestamp")
    if (!verifyOuraWebhookSignature(signature, timestamp, raw)) {
      return errorResponse(401, "unauthorized", "Invalid Oura webhook signature")
    }

    const body = parseBody(raw)
    if (body.event_type === "delete") return NextResponse.json({ ok: true, skipped: "delete" })
    if (!body.object_id || !body.data_type) {
      return errorResponse(400, "validation", "Oura webhook is missing data_type or object_id")
    }

    const { db } = await import("@life-os/db")
    const connection = await findOuraConnection(body.user_id)
    if (!connection) return NextResponse.json({ ok: true, skipped: "no_connection" })

    const result = await ingestOuraWebhookDocument(connection, body.data_type, body.object_id)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof OuraError) {
      return errorResponse(error.code === "revoked" ? 401 : 400, error.code, error.message)
    }
    return handleRouteError(error)
  }
}

async function findOuraConnection(ouraUserId: string | undefined): Promise<OuraConnectionRow | null> {
  const { db } = await import("@life-os/db")
  const rows = await db.connection.findMany({
    where: { kind: "oura", provider: "oura", status: "active" },
    orderBy: { lastSyncedAt: "desc" },
    take: 8,
  })
  if (rows.length === 0) return null
  if (ouraUserId) {
    const matched = rows.find(row => {
      try { return JSON.parse(row.metadata ?? "{}").ouraUserId === ouraUserId } catch { return false }
    })
    if (matched) return matched
    if (rows.length === 1) {
      const metadata = safeMetadata(rows[0].metadata)
      if (!metadata.ouraUserId) {
        await db.connection.update({
          where: { id: rows[0].id },
          data: { metadata: JSON.stringify({ ...metadata, ouraUserId }) },
        })
      }
      return rows[0]
    }
  }
  return rows.length === 1 ? rows[0] : null
}

function parseBody(raw: string) {
  try {
    return JSON.parse(raw) as { event_type?: string; data_type?: string; object_id?: string; user_id?: string }
  } catch {
    return {}
  }
}

function safeMetadata(value: string | null) {
  try { return JSON.parse(value ?? "{}") as Record<string, unknown> } catch { return {} }
}
