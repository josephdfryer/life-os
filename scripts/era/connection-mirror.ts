import type { EraConnection, Prisma } from "@life-os/db"

/** Keep the unified Home-facing row aligned with EraConnection's CLI row of truth. */
export async function mirrorEraConnection(tx: Prisma.TransactionClient, connection: EraConnection) {
  const existing = await tx.connection.findFirst({
    where: {
      workspaceId: connection.workspaceId,
      sourceTable: "EraConnection",
      sourceId: connection.id,
    },
    select: { id: true },
  })
  const data = {
    userId: connection.userId,
    kind: "era",
    provider: "era",
    status: connection.status,
    accountEmail: connection.accountEmail,
    accessTokenEncrypted: connection.accessTokenEncrypted,
    refreshTokenEncrypted: connection.refreshTokenEncrypted,
    expiresAt: connection.expiresAt,
    scope: connection.scope,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
    metadata: JSON.stringify({ syncCursor: connection.syncCursor }),
    sourceTable: "EraConnection",
    sourceId: connection.id,
  }

  if (existing) {
    await tx.connection.update({ where: { id: existing.id }, data })
  } else {
    await tx.connection.create({ data: { workspaceId: connection.workspaceId, ...data } })
  }
}
