import { randomBytes, createHash } from "crypto"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { badRequest, forbidden, notFound, optionalString, optionalStringArray, requiredString, unauthorized } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"

export const DEFAULT_PERMISSIONS = [
  { scope: "*", description: "Full system access" },
  { scope: "people.read", description: "Read people records" },
  { scope: "people.write", description: "Create and update people" },
  { scope: "interactions.read", description: "Read interactions" },
  { scope: "interactions.write", description: "Create and update interactions" },
  { scope: "inbox.review", description: "Review and resolve automation inbox items" },
  { scope: "ingest.write", description: "Run headless ingest/import flows" },
  { scope: "files.read", description: "Read imported source files" },
  { scope: "audit.read", description: "Read audit log entries" },
  { scope: "apiKeys.manage", description: "Create, update, and revoke API keys" },
  { scope: "roles.manage", description: "Create and update roles" },
  { scope: "permissions.manage", description: "Manage permission assignments" },
  { scope: "settings.manage", description: "Manage application settings" },
  { scope: "rules.manage", description: "Manage rules engine configuration" },
  { scope: "automations.manage", description: "Manage automation definitions" },
]

const DEFAULT_ROLES = [
  {
    key: "owner",
    name: "Owner",
    description: "Full access, including access and settings management.",
    scopes: ["*"],
  },
  {
    key: "admin",
    name: "Admin",
    description: "Operational admin access without ownership transfer semantics.",
    scopes: [
      "people.read", "people.write",
      "interactions.read", "interactions.write",
      "inbox.review", "ingest.write", "files.read",
      "audit.read", "apiKeys.manage", "roles.manage", "permissions.manage",
      "settings.manage", "rules.manage", "automations.manage",
    ],
  },
  {
    key: "editor",
    name: "Editor",
    description: "Day-to-day CRM editing access.",
    scopes: [
      "people.read", "people.write",
      "interactions.read", "interactions.write",
      "inbox.review", "ingest.write", "files.read",
    ],
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only CRM access.",
    scopes: ["people.read", "interactions.read", "files.read"],
  },
  {
    key: "automation",
    name: "Automation",
    description: "Machine access for ingest and inbox workflows.",
    scopes: ["people.read", "interactions.read", "interactions.write", "inbox.review", "ingest.write", "files.read"],
  },
]

export type AccessActor = {
  userId: string
  email: string
  workspaceId: string
  workspaceName: string
  actor: DomainActor
  scopes: string[]
}

// Instance-level flag: once seeded in this Fluid Compute instance, skip all
// subsequent seed checks. Fluid Compute reuses instances across requests, so
// this survives for the lifetime of the instance (~minutes to hours).
let _seedVerified = false

export async function seedDefaultAccess(actor?: DomainActor) {
  if (_seedVerified) return

  const [permissionCount, roleCount] = await Promise.all([
    db.permission.count(),
    db.role.count(),
  ])
  const needsSeed = permissionCount < DEFAULT_PERMISSIONS.length || roleCount < DEFAULT_ROLES.length

  if (!needsSeed) {
    _seedVerified = true
    return
  }

  for (const permission of DEFAULT_PERMISSIONS) {
    await db.permission.upsert({
      where: { scope: permission.scope },
      update: { description: permission.description },
      create: permission,
    })
  }

  for (const roleInput of DEFAULT_ROLES) {
    const role = await db.role.upsert({
      where: { key: roleInput.key },
      update: { name: roleInput.name, description: roleInput.description },
      create: { key: roleInput.key, name: roleInput.name, description: roleInput.description },
    })

    for (const scope of roleInput.scopes) {
      const permission = await db.permission.findUnique({ where: { scope }, select: { id: true } })
      if (!permission) continue
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      })
    }
  }

  _seedVerified = true
  await auditAction({ actor, action: "access.seed", targetType: "access" })
}

// Per-instance cache: avoids 6+ sequential Turso RTTs on every request.
// Fluid Compute reuses instances across requests, so this is effective in production.
// 60s TTL means role/scope changes propagate within a minute.
const _accessCache = new Map<string, { value: AccessActor; expiresAt: number }>()

export async function requireAccess(requiredScope: string): Promise<AccessActor> {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) throw unauthorized()

  const hit = _accessCache.get(email)
  if (hit && hit.expiresAt > Date.now()) {
    if (!hasScope(hit.value.scopes, requiredScope)) throw forbidden("Missing required permission", { requiredScope })
    return hit.value
  }

  const name = session?.user?.name ?? null
  const image = session?.user?.image ?? null
  const isOwner = ownerEmails().includes(email)
  const isAllowed = allowedEmails().includes(email)

  // Parallel batch 1: user row + email approval check
  const [existingUser, approvedRow] = await Promise.all([
    db.user.findUnique({ where: { email } }),
    isOwner || isAllowed
      ? Promise.resolve(null)
      : db.approvedEmail.findUnique({ where: { email }, select: { status: true, workspaceId: true } }),
  ])

  if (!isOwner && !isAllowed && approvedRow?.status !== "approved") {
    throw forbidden("Email is not approved for this app", { email })
  }

  const isFirstUser = existingUser === null

  const user = await db.user.upsert({
    where: { email },
    update: { name, image, status: "active" },
    create: { email, name, image, status: "active" },
  })

  if (isFirstUser || isOwner) await grantRole(user.id, "owner")

  // Parallel batch 2: workspace membership + permission scopes
  const [workspaceMember, scopes] = await Promise.all([
    db.workspaceMember.findFirst({
      where: { userId: user.id, status: "active", workspace: { status: "active" } },
      include: { workspace: true },
      orderBy: { createdAt: "asc" },
    }),
    userScopes(user.id),
  ])

  const workspace = workspaceMember?.workspace
    ?? await _buildWorkspace(user.id, email, isFirstUser || isOwner, approvedRow?.workspaceId ?? null)

  if (!hasScope(scopes, requiredScope)) throw forbidden("Missing required permission", { requiredScope })

  const result: AccessActor = {
    userId: user.id,
    email,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    scopes,
    actor: { type: "user", id: user.id, label: email, workspaceId: workspace.id } satisfies DomainActor,
  }

  _accessCache.set(email, { value: result, expiresAt: Date.now() + 60_000 })
  return result
}

async function _buildWorkspace(userId: string, email: string, useDefault: boolean, approvedWorkspaceId: string | null) {
  const workspaceId = useDefault ? "default-workspace" : approvedWorkspaceId
  if (workspaceId) {
    const workspace = await db.workspace.upsert({
      where: { id: workspaceId },
      update: useDefault ? { ownerUserId: userId } : {},
      create: {
        id: workspaceId,
        name: useDefault ? "Joseph's Life OS" : `${displayNameFromEmail(email)}'s Life OS`,
        slug: useDefault ? "joseph-life-os" : uniqueWorkspaceSlug(email),
        ownerUserId: userId,
      },
    })
    await addWorkspaceMember(workspace.id, userId, "owner")
    return workspace
  }
  const workspace = await db.workspace.create({
    data: {
      name: `${displayNameFromEmail(email)}'s Life OS`,
      slug: uniqueWorkspaceSlug(email),
      ownerUserId: userId,
    },
  })
  await addWorkspaceMember(workspace.id, userId, "owner")
  return workspace
}

export async function accessOverview(actor: AccessActor) {
  await seedDefaultAccess(actor.actor)
  const [users, roles, permissions, apiKeys, auditCount, approvedEmails, workspaces] = await Promise.all([
    db.user.findMany({
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
      include: { workspace: true, invitedBy: true },
      orderBy: { createdAt: "desc" },
    }),
    db.workspace.findMany({ orderBy: { name: "asc" } }),
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
  const workspaceId = optionalString(input.workspaceId) || null

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
  const existing = await db.approvedEmail.findUnique({ where: { id } })
  if (!existing) throw notFound("Approved email not found", { id })

  const patch: Record<string, unknown> = {}
  if (input.status !== undefined) patch.status = requiredString(input.status, "status")
  if ("workspaceId" in input) patch.workspaceId = optionalString(input.workspaceId) || null

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

export async function auditLogList(input: { limit?: number; action?: string | null; actorType?: string | null }) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 250)
  const logs = await db.auditLog.findMany({
    where: {
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

async function grantRole(userId: string, key: string) {
  const role = await db.role.findUnique({ where: { key }, select: { id: true } })
  if (!role) return
  await db.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id },
  })
}


async function addWorkspaceMember(workspaceId: string, userId: string, role: string) {
  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    update: { role, status: "active" },
    create: { workspaceId, userId, role, status: "active" },
  })
}

async function userScopes(userId: string): Promise<string[]> {
  const roles = await db.userRole.findMany({
    where: { userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  })
  return [...new Set(roles.flatMap(item => item.role.permissions.map(rp => rp.permission.scope as string)))]
}

function hasScope(granted: string[], required: string) {
  if (granted.includes("*")) return true
  const legacyRequired = required === "people.read"
    ? "contacts.read"
    : required === "people.write"
      ? "contacts.write"
      : null
  if (legacyRequired && (granted.includes(legacyRequired) || granted.includes("contacts.*"))) return true
  return granted.includes(required) || granted.includes(`${required.split(".")[0]}.*`)
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

function ownerEmails() {
  return [
    process.env.OWNER_EMAILS,
    process.env.ADMIN_EMAILS,
  ].filter(Boolean)
    .flatMap(value => value!.split(","))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
}

function allowedEmails() {
  return [process.env.ALLOWED_EMAILS]
    .filter(Boolean)
    .flatMap(value => value!.split(","))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
}

function displayNameFromEmail(email: string) {
  const local = email.split("@")[0] ?? "Person"
  return local.split(/[._-]+/).filter(Boolean).map(part => part[0]?.toUpperCase() + part.slice(1)).join(" ") || "Person"
}

function uniqueWorkspaceSlug(email: string) {
  const base = email.toLowerCase().replace(/@/g, "-").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return `${base || "workspace"}-${createHash("sha1").update(email).digest("hex").slice(0, 8)}`
}

function parseJson(value: string | null) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
