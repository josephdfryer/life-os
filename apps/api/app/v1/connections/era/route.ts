import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Connect (or rotate) Era's API key — the first real web UI for an
 * integration that has been CLI-only (scripts/era/store-api-key.ts) since
 * it was built. Era is a static API key, not an OAuth token, so this is a
 * straightforward store-and-verify, closer to apps/stuff's
 * AiProviderCredential wardrobe settings than to Calendar/Gmail's OAuth
 * dance.
 *
 * Writes EraConnection directly (the real row scripts/era/*.ts's sync
 * pipeline reads) and dual-writes a Connection mirror row for the unified
 * hub — same interim pattern as Calendar/Gmail, see
 * docs/adr/0003-connection-model.md.
 *
 *   POST /v1/connections/era  { apiKey: string }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "connections.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const body = await req.json()
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : ""
    if (!apiKey) return errorResponse(400, "validation", "apiKey is required")

    const { db } = await import("@life-os/db")
    const { encrypt, decrypt } = await import("@life-os/db/crypto")
    const workspaceId = auth.workspaceId

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        ownerUserId: true,
        members: {
          where: { status: "active" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { userId: true },
        },
      },
    })
    const userId = workspace?.ownerUserId ?? workspace?.members[0]?.userId
    if (!userId) return errorResponse(400, "validation", "No user found to own the Era connection")

    const ciphertext = encrypt(apiKey)
    // Prove the round-trip before persisting — same defense-in-depth as
    // scripts/era/store-api-key.ts: a key that can't be decrypted is worse
    // than no key, since the failure would otherwise surface at sync time.
    if (decrypt(ciphertext) !== apiKey) return errorResponse(502, "internal_error", "Encryption round-trip failed; key not stored")

    const eraConnection = await db.eraConnection.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      update: { accessTokenEncrypted: ciphertext, scope: "api-key", status: "active", lastError: null },
      create: {
        workspaceId,
        userId,
        accessTokenEncrypted: ciphertext,
        scope: "api-key",
        status: "active",
      },
    })

    // Not a Prisma upsert: the one-mirror-per-source invariant is enforced
    // here at the application layer (see schema.prisma's comment on
    // Connection — a nullable accountEmail makes a compound-unique upsert
    // unusable), by looking the mirror up on (sourceTable, sourceId) first.
    const existingMirror = await db.connection.findFirst({
      where: { workspaceId, sourceTable: "EraConnection", sourceId: eraConnection.id },
    })
    const mirror = existingMirror
      ? await db.connection.update({
          where: { id: existingMirror.id },
          data: { status: "active", accessTokenEncrypted: ciphertext, scope: "api-key", lastError: null },
        })
      : await db.connection.create({
          data: {
            workspaceId,
            userId,
            kind: "era",
            provider: "era",
            status: "active",
            accessTokenEncrypted: ciphertext,
            scope: "api-key",
            sourceTable: "EraConnection",
            sourceId: eraConnection.id,
          },
        })

    return NextResponse.json({ connection: { id: mirror.id, kind: mirror.kind, status: mirror.status } }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
