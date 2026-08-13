import { auditLogPageContract, auditLogResourceContract, type AuditLogResource } from "@life-os/contracts"
import { db } from "@life-os/db"

export class AuditLogApiError extends Error {
  constructor(message: string, readonly code: "validation") {
    super(message)
    this.name = "AuditLogApiError"
  }
}

export type ListAuditLogParams = {
  cursor?: string | null
  limit?: number
  action?: string | null
  actorType?: string | null
  targetType?: string | null
  targetId?: string | null
}

export async function listAuditLog(params: ListAuditLogParams, workspaceId: string) {
  const limit = boundedLimit(params.limit)
  const and: Record<string, unknown>[] = []
  if (params.cursor) {
    const { createdAt, id } = decodeAuditCursor(params.cursor)
    and.push({ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] })
  }

  const rows = await db.auditLog.findMany({
    where: {
      workspaceId,
      ...(params.action ? { action: params.action } : {}),
      ...(params.actorType ? { actorType: params.actorType } : {}),
      ...(params.targetType ? { targetType: params.targetType } : {}),
      ...(params.targetId ? { targetId: params.targetId } : {}),
      ...(and.length ? { AND: and } : {}),
    },
    include: {
      user: { select: { id: true, email: true, name: true } },
      apiKey: { select: { id: true, name: true, keyPrefix: true } },
      person: { select: { id: true, first: true, last: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page.at(-1)
  return auditLogPageContract.parse({
    data: page.map(formatAuditLogResource),
    nextCursor: hasMore && last ? encodeAuditCursor(last.createdAt, last.id) : null,
    hasMore,
    limit,
  })
}

type AuditLogRow = Awaited<ReturnType<typeof db.auditLog.findMany>>[number] & {
  user?: { id: string; email: string; name: string | null } | null
  apiKey?: { id: string; name: string; keyPrefix: string } | null
  person?: { id: string; first: string; last: string } | null
}

export function formatAuditLogResource(row: AuditLogRow): AuditLogResource {
  return auditLogResourceContract.parse({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    actorType: row.actorType,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    metadata: parseMetadata(row.metadata),
    user: row.user ?? null,
    apiKey: row.apiKey ?? null,
    person: row.person ?? null,
  })
}

function boundedLimit(value: number | undefined) {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new AuditLogApiError("limit must be a positive integer", "validation")
  }
  return Math.min(250, value ?? 100)
}

function parseMetadata(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return raw }
}

function encodeAuditCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url")
}

function decodeAuditCursor(cursor: string) {
  let decoded: string
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8")
  } catch {
    throw new AuditLogApiError("cursor is not valid base64url", "validation")
  }
  const separator = decoded.indexOf("|")
  if (separator <= 0) throw new AuditLogApiError("cursor is malformed", "validation")
  const createdAt = new Date(decoded.slice(0, separator))
  const id = decoded.slice(separator + 1)
  if (Number.isNaN(createdAt.getTime()) || !id) throw new AuditLogApiError("cursor is malformed", "validation")
  return { createdAt, id }
}
