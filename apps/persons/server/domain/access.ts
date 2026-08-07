import { randomBytes, createHash } from "crypto"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { badRequest, forbidden, notFound, optionalString, optionalStringArray, requiredString, unauthorized } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import { localReviewEnabled } from "@/lib/local-review"
import { createAccessService, type AccessActor as SharedAccessActor } from "@life-os/access"

const sharedAccess = createAccessService({
  getSession: auth,
  errors: { badRequest, forbidden, unauthorized },
  auditAction,
  localReviewEnabled,
})

export const requireAccess = sharedAccess.requireAccess

// `@life-os/access` (packages/access/index.ts) is the canonical scope/role
// list. This file used to re-declare its own copy — missing places.* and,
// before docs/adr/0002-graph-event-spine.md, the control-plane scopes — which
// meant this app's local seed (below, now removed) silently drifted from the
// shared one that `requireAccess` actually seeds internally. Delegate to the
// package so there is exactly one list.
export const seedDefaultAccess = sharedAccess.seedDefaultAccess

export type AccessActor = SharedAccessActor

export async function accessOverview(actor: AccessActor) {
  await seedDefaultAccess(actor.actor)
  // Role/Permission are genuinely global (they aren't tenant data), but
  // users, approved emails, and workspaces must be scoped to the caller's
  // own workspace — this is an admin view, not a cross-tenant directory.
  const [users, roles, permissions, apiKeys, auditCount, approvedEmails, workspaces] = await Promise.all([
    db.user.findMany({
      where: { workspaceMemberships: { some: { workspaceId: actor.workspaceId } } },
      include: { roles: { include: { role: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.role.findMany({
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
      orderBy: { name: "asc" },
    }),
    db.permission.findMany({ orderBy: { scope: "asc" } }),
    db.apiKey.findMany({
      where: { workspaceId: actor.workspaceId },
      include: { scopes: true, createdByUser: true, ownerPerson: true },
      orderBy: { createdAt: "desc" },
    }),
    db.auditLog.count({ where: { workspaceId: actor.workspaceId } }),
    db.approvedEmail.findMany({
      where: { workspaceId: actor.workspaceId },
      include: { workspace: true, invitedBy: true },
      orderBy: { createdAt: "desc" },
    }),
    db.workspace.findMany({ where: { id: actor.workspaceId }, orderBy: { name: "asc" } }),
  ])

  return {
    currentUser: { id: actor.userId, email: actor.email, scopes: actor.scopes, workspaceId: actor.workspaceId, workspaceName: actor.workspaceName },
    users: users.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      status: user.status,
      createdAt: user.createdAt,
      roles: user.roles.map(item => ({ id: item.role.id, key: item.role.key, name: item.role.name })),
    })),
    roles: roles.map(role => formatRole(role)),
    permissions,
    apiKeys: apiKeys.map(formatApiKey),
    auditCount,
    approvedEmails: approvedEmails.map(formatApprovedEmail),
    workspaces: workspaces.map(ws => ({ id: ws.id, name: ws.name, slug: ws.slug, status: ws.status })),
  }
}

export async function addApprovedEmail(input: Record<string, unknown>, actor: AccessActor) {
  const email = requiredString(input.email, "email").toLowerCase().trim()
  // An admin can only invite people into their own workspace — never an
  // arbitrary workspaceId supplied by the client.
  const workspaceId = actor.workspaceId

  const existing = await db.approvedEmail.findUnique({ where: { email } })
  if (existing) throw badRequest("Email is already approved", { field: "email" })

  const record = await db.approvedEmail.create({
    data: { email, status: "approved", workspaceId, invitedById: actor.userId },
    include: { workspace: true, invitedBy: true },
  })

  await auditAction({
    actor: actor.actor,
    action: "approvedEmail.create",
    targetType: "approvedEmail",
    targetId: record.id,
    metadata: { email, workspaceId },
  })

  return { approvedEmail: formatApprovedEmail(record) }
}

export async function updateApprovedEmail(id: string, input: Record<string, unknown>, actor: AccessActor) {
  const existing = await db.approvedEmail.findFirst({ where: { id, workspaceId: actor.workspaceId } })
  if (!existing) throw notFound("Approved email not found", { id })

  const patch: Record<string, unknown> = {}
  if (input.status !== undefined) patch.status = requiredString(input.status, "status")
  // workspaceId is intentionally not re-assignable via this endpoint — an
  // admin cannot move an approval into a different tenant.

  const updated = await db.approvedEmail.update({
    where: { id },
    data: patch,
    include: { workspace: true, invitedBy: true },
  })

  await auditAction({
    actor: actor.actor,
    action: "approvedEmail.update",
    targetType: "approvedEmail",
    targetId: id,
    metadata: patch,
  })

  return { approvedEmail: formatApprovedEmail(updated) }
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

export async function createApiKey(input: Record<string, unknown>, actor: AccessActor) {
  const name = requiredString(input.name, "name")
  const scopes = optionalStringArray(input.scopes)
  if (!scopes.length) throw badRequest("Choose at least one scope", { field: "scopes" })
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

  await auditAction({
    actor: actor.actor,
    action: "apiKey.create",
    targetType: "apiKey",
    targetId: apiKey.id,
    metadata: { name, scopes },
  })

  return { apiKey: formatApiKey(apiKey), secret }
}

export async function updateApiKey(id: string, input: Record<string, unknown>, actor: AccessActor) {
  const existing = await db.apiKey.findFirst({ where: { id, workspaceId: actor.workspaceId }, include: { scopes: true } })
  if (!existing) throw notFound("API key not found", { id })

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

  await auditAction({
    actor: actor.actor,
    action: "apiKey.update",
    targetType: "apiKey",
    targetId: id,
    metadata: { fields: Object.keys(patch), scopesChanged: Boolean(scopes) },
  })
  return formatApiKey(updated!)
}

export async function createRole(input: Record<string, unknown>, actor: AccessActor) {
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
  await auditAction({ actor: actor.actor, action: "role.create", targetType: "role", targetId: role.id, metadata: { key, scopes } })
  return formatRole(role)
}

export async function updateRole(id: string, input: Record<string, unknown>, actor: AccessActor) {
  const existing = await db.role.findUnique({ where: { id } })
  if (!existing) throw notFound("Role not found", { id })
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

  await auditAction({ actor: actor.actor, action: "role.update", targetType: "role", targetId: id, metadata: { fields: Object.keys(patch), scopesChanged: Boolean(scopes) } })
  return formatRole(role!)
}

export async function updateUserRoles(userId: string, input: Record<string, unknown>, actor: AccessActor) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
  if (!user) throw notFound("User not found", { userId })
  const roleIds = optionalStringArray(input.roleIds)
  const roles = await db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, key: true } })
  if (roles.length !== roleIds.length) throw badRequest("Unknown role IDs", { roleIds })

  await db.$transaction(async tx => {
    await tx.userRole.deleteMany({ where: { userId } })
    for (const role of roles) {
      await tx.userRole.create({ data: { userId, roleId: role.id } })
    }
  })

  await auditAction({
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

export async function auditLogList(input: { workspaceId: string; limit?: number; action?: string | null; actorType?: string | null }) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 250)
  const logs = await db.auditLog.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.action ? { action: input.action } : {}),
      ...(input.actorType ? { actorType: input.actorType } : {}),
    },
    include: { user: true, apiKey: true, person: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  })

  return {
    logs: logs.map(log => ({
      ...log,
      metadata: parseJson(log.metadata),
      user: log.user ? { id: log.user.id, email: log.user.email, name: log.user.name } : null,
      apiKey: log.apiKey ? { id: log.apiKey.id, name: log.apiKey.name, keyPrefix: log.apiKey.keyPrefix } : null,
      person: log.person ? { id: log.person.id, first: log.person.first, last: log.person.last } : null,
    })),
  }
}

async function assertKnownScopes(scopes: string[]) {
  if (!scopes.length) return
  const permissions = await db.permission.findMany({ where: { scope: { in: scopes } }, select: { scope: true } })
  const known = new Set(permissions.map(permission => permission.scope))
  const unknown = scopes.filter(scope => !known.has(scope))
  if (unknown.length) throw badRequest("Unknown permission scopes", { scopes: unknown })
}

async function permissionLinks(scopes: string[]) {
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

function hashApiKey(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function parseJson(value: string | null) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
