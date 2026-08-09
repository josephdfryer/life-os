import { db } from "@/lib/db"
import { auth } from "@/auth"
import { badRequest, forbidden, notFound, unauthorized } from "@/server/api/errors"
import { auditAction } from "./audit"
import { localReviewEnabled } from "@/lib/local-review"
import {
  createAccessService,
  AccessError,
  type AccessActor as SharedAccessActor,
  addApprovedEmail as sharedAddApprovedEmail,
  updateApprovedEmail as sharedUpdateApprovedEmail,
  createApiKey as sharedCreateApiKey,
  updateApiKey as sharedUpdateApiKey,
  createRole as sharedCreateRole,
  updateRole as sharedUpdateRole,
  updateUserRoles as sharedUpdateUserRoles,
} from "@life-os/access"

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

// Write operations (API keys, roles, workspace/approved-emails) moved to
// @life-os/access/admin.ts (Track C, Phase C1) so apps/api can expose them
// without depending on apps/persons/server — same shim pattern as
// apps/persons/server/domain/rules.ts over @life-os/automation. This app's
// existing (soon-to-be-deleted) Admin routes keep working unchanged;
// AccessError translates to this app's own HTTP-shaped errors.
function translate<T>(promise: Promise<T>): Promise<T> {
  return promise.catch(error => {
    if (error instanceof AccessError) throw error.code === "not_found" ? notFound(error.message) : badRequest(error.message)
    throw error
  })
}

export function addApprovedEmail(input: Record<string, unknown>, actor: AccessActor) {
  return translate(sharedAddApprovedEmail(input, actor))
}

export function updateApprovedEmail(id: string, input: Record<string, unknown>, actor: AccessActor) {
  return translate(sharedUpdateApprovedEmail(id, input, actor))
}

export function createApiKey(input: Record<string, unknown>, actor: AccessActor) {
  return translate(sharedCreateApiKey(input, actor))
}

export function updateApiKey(id: string, input: Record<string, unknown>, actor: AccessActor) {
  return translate(sharedUpdateApiKey(id, input, actor))
}

export function createRole(input: Record<string, unknown>, actor: AccessActor) {
  return translate(sharedCreateRole(input, actor))
}

export function updateRole(id: string, input: Record<string, unknown>, actor: AccessActor) {
  return translate(sharedUpdateRole(id, input, actor))
}

export function updateUserRoles(userId: string, input: Record<string, unknown>, actor: AccessActor) {
  return translate(sharedUpdateUserRoles(userId, input, actor))
}

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

function parseJson(value: string | null) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
