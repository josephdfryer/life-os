import { randomBytes, createHash } from "node:crypto"
import { writeAuditLog } from "@life-os/domain"
import type { AccessActor } from "./index"

// Extracted from apps/persons/server/domain/access.ts (Track C, Phase C1) —
// the write side of Persons' legacy Admin page (API Keys, Roles, Workspace/
// approved-emails tabs), moved here so apps/api can expose it without
// depending on apps/persons/server. Persons' own copy becomes a thin
// re-export shim (same pattern as apps/persons/server/domain/rules.ts over
// @life-os/automation) so its existing (soon-to-be-deleted) routes keep
// working unchanged in the meantime.
//
// Unlike requireAccess (createAccessService in ./index.ts), these functions
// take an already-resolved AccessActor rather than needing a session-getter
// injected — there is nothing app-specific left to inject.

export class AccessError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "AccessError"
  }
}

export async function addApprovedEmail(input: Record<string, unknown>, actor: AccessActor) {
  const { db } = await import("@life-os/db")
  const email = requiredString(input.email, "email").toLowerCase().trim()
  // An admin can only invite people into their own workspace — never an
  // arbitrary workspaceId supplied by the client.
  const workspaceId = actor.workspaceId

  const existing = await db.approvedEmail.findUnique({ where: { email } })
  if (existing) throw new AccessError("Email is already approved", "validation")

  const record = await db.approvedEmail.create({
    data: { email, status: "approved", workspaceId, invitedById: actor.userId },
    include: { workspace: true, invitedBy: true },
  })

  await writeAuditLog({
    actor: actor.actor,
    action: "approvedEmail.create",
    targetType: "approvedEmail",
    targetId: record.id,
    metadata: { email, workspaceId },
  })

  return { approvedEmail: formatApprovedEmail(record) }
}

export async function updateApprovedEmail(id: string, input: Record<string, unknown>, actor: AccessActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.approvedEmail.findFirst({ where: { id, workspaceId: actor.workspaceId } })
  if (!existing) throw new AccessError("Approved email not found", "not_found")

  const patch: Record<string, unknown> = {}
  if (input.status !== undefined) patch.status = requiredString(input.status, "status")
  // workspaceId is intentionally not re-assignable via this endpoint — an
  // admin cannot move an approval into a different tenant.

  const updated = await db.approvedEmail.update({
    where: { id },
    data: patch,
    include: { workspace: true, invitedBy: true },
  })

  await writeAuditLog({
    actor: actor.actor,
    action: "approvedEmail.update",
    targetType: "approvedEmail",
    targetId: id,
    metadata: patch,
  })

  return { approvedEmail: formatApprovedEmail(updated) }
}

export async function createApiKey(input: Record<string, unknown>, actor: AccessActor) {
  const { db } = await import("@life-os/db")
  const name = requiredString(input.name, "name")
  const scopes = optionalStringArray(input.scopes)
  if (!scopes.length) throw new AccessError("Choose at least one scope", "validation")
  await assertKnownScopes(scopes)

  const secret = `pk_${randomBytes(24).toString("base64url")}`
  const apiKey = await db.apiKey.create({
    data: {
      name,
      keyPrefix: secret.slice(0, 12),
      keyHash: hashApiKey(secret),
      status: "active",
      workspaceId: actor.workspaceId,
      expiresAt: input.expiresAt ? new Date(String(input.expiresAt)) : null,
      createdByUserId: actor.userId,
      scopes: { create: scopes.map(scope => ({ scope })) },
    },
    include: { scopes: true, createdByUser: true, ownerPerson: true },
  })

  await writeAuditLog({
    actor: actor.actor,
    action: "apiKey.create",
    targetType: "apiKey",
    targetId: apiKey.id,
    metadata: { name, scopes },
  })

  return { apiKey: formatApiKey(apiKey), secret }
}

export async function updateApiKey(id: string, input: Record<string, unknown>, actor: AccessActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.apiKey.findFirst({ where: { id, workspaceId: actor.workspaceId }, include: { scopes: true } })
  if (!existing) throw new AccessError("API key not found", "not_found")

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = requiredString(input.name, "name")
  if (input.status !== undefined) patch.status = requiredString(input.status, "status")
  if (input.expiresAt !== undefined) patch.expiresAt = input.expiresAt ? new Date(String(input.expiresAt)) : null

  const scopes = input.scopes === undefined ? null : optionalStringArray(input.scopes)
  if (scopes) await assertKnownScopes(scopes)

  const updated = await db.$transaction(async tx => {
    if (Object.keys(patch).length) await tx.apiKey.update({ where: { id }, data: patch })
    if (scopes) {
      await tx.apiKeyScope.deleteMany({ where: { apiKeyId: id } })
      for (const scope of scopes) {
        await tx.apiKeyScope.create({ data: { apiKeyId: id, scope } })
      }
    }
    return tx.apiKey.findUnique({
      where: { id },
      include: { scopes: true, createdByUser: true, ownerPerson: true },
    })
  })

  await writeAuditLog({
    actor: actor.actor,
    action: "apiKey.update",
    targetType: "apiKey",
    targetId: id,
    metadata: { fields: Object.keys(patch), scopesChanged: Boolean(scopes) },
  })
  return formatApiKey(updated!)
}

export async function createRole(input: Record<string, unknown>, actor: AccessActor) {
  const { db } = await import("@life-os/db")
  const key = requiredString(input.key, "key").toLowerCase().replace(/[^a-z0-9_.-]/g, "-")
  const scopes = optionalStringArray(input.scopes)
  await assertKnownScopes(scopes)
  const role = await db.role.create({
    data: {
      key,
      name: requiredString(input.name, "name"),
      description: optionalString(input.description),
      permissions: { create: await permissionLinks(scopes) },
    },
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
  })
  await writeAuditLog({ actor: actor.actor, action: "role.create", targetType: "role", targetId: role.id, metadata: { key, scopes } })
  return formatRole(role)
}

export async function updateRole(id: string, input: Record<string, unknown>, actor: AccessActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.role.findUnique({ where: { id } })
  if (!existing) throw new AccessError("Role not found", "not_found")
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = requiredString(input.name, "name")
  if (input.description !== undefined) patch.description = optionalString(input.description)

  const scopes = input.scopes === undefined ? null : optionalStringArray(input.scopes)
  if (scopes) await assertKnownScopes(scopes)

  const role = await db.$transaction(async tx => {
    if (Object.keys(patch).length) await tx.role.update({ where: { id }, data: patch })
    if (scopes) {
      await tx.rolePermission.deleteMany({ where: { roleId: id } })
      const links = await permissionLinks(scopes)
      for (const link of links) await tx.rolePermission.create({ data: { roleId: id, permissionId: link.permissionId } })
    }
    return tx.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
    })
  })

  await writeAuditLog({ actor: actor.actor, action: "role.update", targetType: "role", targetId: id, metadata: { fields: Object.keys(patch), scopesChanged: Boolean(scopes) } })
  return formatRole(role!)
}

export async function updateUserRoles(userId: string, input: Record<string, unknown>, actor: AccessActor) {
  const { db } = await import("@life-os/db")
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
  if (!user) throw new AccessError("User not found", "not_found")
  const roleIds = optionalStringArray(input.roleIds)
  const roles = await db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, key: true } })
  if (roles.length !== roleIds.length) throw new AccessError("Unknown role IDs", "validation")

  await db.$transaction(async tx => {
    await tx.userRole.deleteMany({ where: { userId } })
    for (const role of roles) {
      await tx.userRole.create({ data: { userId, roleId: role.id } })
    }
  })

  await writeAuditLog({
    actor: actor.actor,
    action: "user.roles.update",
    targetType: "user",
    targetId: userId,
    metadata: { email: user.email, roles: roles.map(role => role.key) },
  })

  return db.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  })
}

async function assertKnownScopes(scopes: string[]) {
  if (!scopes.length) return
  const { db } = await import("@life-os/db")
  const permissions = await db.permission.findMany({ where: { scope: { in: scopes } }, select: { scope: true } })
  const known = new Set(permissions.map(permission => permission.scope))
  const unknown = scopes.filter(scope => !known.has(scope))
  if (unknown.length) throw new AccessError(`Unknown permission scopes: ${unknown.join(", ")}`, "validation")
}

async function permissionLinks(scopes: string[]) {
  const { db } = await import("@life-os/db")
  const permissions = await db.permission.findMany({ where: { scope: { in: scopes } }, select: { id: true } })
  return permissions.map(permission => ({ permissionId: permission.id }))
}

function formatRole(role: {
  id: string
  key: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
  permissions: { permission: { id: string; scope: string; description: string | null } }[]
  _count?: { users: number }
}) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    userCount: role._count?.users ?? 0,
    permissions: role.permissions.map(item => item.permission).sort((a, b) => a.scope.localeCompare(b.scope)),
  }
}

function formatApiKey(apiKey: {
  id: string
  createdAt: Date
  updatedAt: Date
  name: string
  keyPrefix: string
  status: string
  expiresAt: Date | null
  lastUsedAt: Date | null
  scopes: { scope: string }[]
  createdByUser?: { id: string; email: string; name: string | null } | null
  ownerPerson?: { id: string; first: string; last: string } | null
}) {
  return {
    id: apiKey.id,
    createdAt: apiKey.createdAt,
    updatedAt: apiKey.updatedAt,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    status: apiKey.status,
    expiresAt: apiKey.expiresAt,
    lastUsedAt: apiKey.lastUsedAt,
    scopes: apiKey.scopes.map(scope => scope.scope).sort(),
    createdByUser: apiKey.createdByUser ? {
      id: apiKey.createdByUser.id,
      email: apiKey.createdByUser.email,
      name: apiKey.createdByUser.name,
    } : null,
    ownerPerson: apiKey.ownerPerson ? {
      id: apiKey.ownerPerson.id,
      name: `${apiKey.ownerPerson.first} ${apiKey.ownerPerson.last}`,
    } : null,
  }
}

function formatApprovedEmail(record: {
  id: string
  email: string
  status: string
  workspaceId: string | null
  createdAt: Date
  workspace: { id: string; name: string; slug: string } | null
  invitedBy: { id: string; email: string; name: string | null } | null
}) {
  return {
    id: record.id,
    email: record.email,
    status: record.status,
    workspaceId: record.workspaceId,
    createdAt: record.createdAt,
    workspace: record.workspace ? { id: record.workspace.id, name: record.workspace.name, slug: record.workspace.slug } : null,
    invitedBy: record.invitedBy ? { id: record.invitedBy.id, email: record.invitedBy.email, name: record.invitedBy.name } : null,
  }
}

function hashApiKey(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AccessError(`${field} is required`, "validation")
  return value.trim()
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}
