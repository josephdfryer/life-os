import { createHash } from "node:crypto"
import { db, WorkspaceRole } from "@life-os/db"

export type DomainActor = {
  type: "user" | "api_key" | "system"
  id?: string | null
  label?: string | null
  workspaceId?: string | null
}

export type AccessActor = {
  userId: string
  email: string
  workspaceId: string
  workspaceName: string
  actor: DomainActor
  scopes: string[]
}

type Session = {
  user?: {
    email?: string | null
    name?: string | null
    image?: string | null
  } | null
} | null

type AccessDependencies = {
  getSession: () => Promise<Session>
  errors: {
    badRequest: (message: string, details?: unknown) => Error
    forbidden: (message?: string, details?: unknown) => Error
    unauthorized: (message?: string, details?: unknown) => Error
  }
  auditAction?: (input: {
    actor?: DomainActor
    action: "access.seed"
    targetType: "access"
  }) => Promise<unknown>
  localReviewEnabled?: () => boolean
}

export const DEFAULT_PERMISSIONS = [
  { scope: "*", description: "Full system access" },
  { scope: "people.read", description: "Read people records" },
  { scope: "people.write", description: "Create and update people" },
  { scope: "places.read", description: "Read place records and derived place graph views" },
  { scope: "places.write", description: "Create and update place notes and place preferences" },
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

  // Control plane (docs/adr/0002-graph-event-spine.md): the unified stream,
  // universal review inbox, automation run history, intelligence snapshots,
  // and the raw event ledger. Additive — every existing scope above is
  // unchanged, and DEFAULT_ROLES below only grants these where a role
  // already implied the equivalent capability.
  { scope: "stream.read", description: "Read the unified cross-primitive interaction stream" },
  { scope: "review.read", description: "Read universal review Inbox items" },
  { scope: "review.write", description: "Accept, edit, or dismiss review Inbox items" },
  { scope: "automations.read", description: "Read automation run history and definitions" },
  { scope: "intelligence.read", description: "Read whole-life intelligence snapshots and insights" },
  { scope: "intelligence.write", description: "Correct insights and record synthesis feedback" },
  { scope: "events.read", description: "Read the raw GraphEvent ledger" },
  { scope: "notes.read", description: "Read notes" },
  { scope: "notes.write", description: "Create and update notes" },
  { scope: "plans.read", description: "Read plans" },
  { scope: "plans.write", description: "Create and update plans" },
  { scope: "states.read", description: "Read recorded states" },
  { scope: "states.write", description: "Record states" },
  { scope: "groups.read", description: "Read groups" },
  { scope: "groups.write", description: "Create and update groups" },
  { scope: "items.read", description: "Read items" },
  { scope: "items.write", description: "Create and update items" },
] as const

export const DEFAULT_ROLES = [
  { key: "owner", name: "Owner", description: "Full access, including access and settings management.", scopes: ["*"] },
  {
    key: "admin",
    name: "Admin",
    description: "Operational admin access without ownership transfer semantics.",
    scopes: [
      "people.read", "people.write", "places.read", "places.write",
      "interactions.read", "interactions.write", "inbox.review", "ingest.write", "files.read",
      "audit.read", "apiKeys.manage", "roles.manage", "permissions.manage", "settings.manage",
      "rules.manage", "automations.manage",
      "stream.read", "review.read", "review.write", "automations.read",
      "intelligence.read", "intelligence.write", "events.read",
      "notes.read", "notes.write", "plans.read", "plans.write",
      "states.read", "states.write", "groups.read", "groups.write", "items.read", "items.write",
    ],
  },
  {
    key: "editor",
    name: "Editor",
    description: "Day-to-day editing access.",
    scopes: [
      "people.read", "people.write", "places.read", "places.write",
      "interactions.read", "interactions.write", "inbox.review", "ingest.write", "files.read",
      "stream.read", "review.read", "review.write", "intelligence.read",
      "notes.read", "notes.write", "plans.read", "plans.write",
      "states.read", "states.write", "groups.read", "groups.write", "items.read", "items.write",
    ],
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access.",
    scopes: [
      "people.read", "places.read", "interactions.read", "files.read",
      "stream.read", "review.read", "automations.read", "intelligence.read", "events.read",
      "notes.read", "plans.read", "states.read", "groups.read", "items.read",
    ],
  },
  {
    key: "automation",
    name: "Automation",
    description: "Machine access for ingest and inbox workflows.",
    scopes: [
      "people.read", "places.read", "interactions.read", "interactions.write",
      "inbox.review", "ingest.write", "files.read",
      "stream.read", "review.read", "review.write", "automations.read", "events.read",
      "notes.read", "notes.write", "plans.read", "plans.write", "states.read", "states.write",
    ],
  },
] as const

export function createAccessService(dependencies: AccessDependencies) {
  let seedVerified = false
  const accessCache = new Map<string, { value: AccessActor; expiresAt: number }>()

  async function seedDefaultAccess(actor?: DomainActor) {
    if (seedVerified) return

    const [permissionCount, roleCount] = await Promise.all([
      db.permission.count(),
      db.role.count(),
    ])
    const needsSeed = permissionCount < DEFAULT_PERMISSIONS.length || roleCount < DEFAULT_ROLES.length
    if (!needsSeed) {
      seedVerified = true
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

    seedVerified = true
    await dependencies.auditAction?.({ actor, action: "access.seed", targetType: "access" })
  }

  async function requireAccess(requiredScope: string, workspaceId?: string): Promise<AccessActor> {
    if (isLocalReviewEnabled(dependencies)) return localReviewActor(dependencies)

    const session = await dependencies.getSession()
    const email = session?.user?.email?.toLowerCase()
    if (!email) throw dependencies.errors.unauthorized()

    await seedDefaultAccess()

    const cacheKey = `${email}::${workspaceId ?? "__auto__"}`
    const hit = accessCache.get(cacheKey)
    if (hit && hit.expiresAt > Date.now()) {
      if (!hasScope(hit.value.scopes, requiredScope)) {
        throw dependencies.errors.forbidden("Missing required permission", { requiredScope })
      }
      return hit.value
    }

    const name = session?.user?.name ?? null
    const image = session?.user?.image ?? null
    const isOwner = ownerEmails().includes(email)
    const isAllowed = allowedEmails().includes(email)
    const [existingUser, approvedRow] = await Promise.all([
      db.user.findUnique({ where: { email } }),
      isOwner || isAllowed
        ? Promise.resolve(null)
        : db.approvedEmail.findUnique({ where: { email }, select: { status: true, workspaceId: true } }),
    ])

    if (!isOwner && !isAllowed && approvedRow?.status !== "approved") {
      throw dependencies.errors.forbidden("Email is not approved for this app", { email })
    }
    if (existingUser && existingUser.status !== "active") {
      throw dependencies.errors.forbidden("Account is disabled", { email })
    }

    const isFirstUser = existingUser === null
    const user = existingUser
      ? await db.user.update({ where: { id: existingUser.id }, data: { name, image } })
      : await db.user.create({ data: { email, name, image, status: "active" } })

    if (isFirstUser || isOwner) await grantRole(user.id, "owner")
    const [scopes, workspace] = await Promise.all([
      userScopes(user.id),
      resolveWorkspace(user.id, email, workspaceId, isFirstUser || isOwner, approvedRow?.workspaceId ?? null, dependencies),
    ])

    if (!hasScope(scopes, requiredScope)) {
      throw dependencies.errors.forbidden("Missing required permission", { requiredScope })
    }

    const result: AccessActor = {
      userId: user.id,
      email,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      scopes,
      actor: { type: "user", id: user.id, label: email, workspaceId: workspace.id },
    }
    accessCache.set(cacheKey, { value: result, expiresAt: Date.now() + 60_000 })
    return result
  }

  return { requireAccess, seedDefaultAccess }
}

async function resolveWorkspace(
  userId: string,
  email: string,
  workspaceId: string | undefined,
  useDefaultBootstrap: boolean,
  approvedWorkspaceId: string | null,
  dependencies: AccessDependencies,
) {
  if (workspaceId) {
    const member = await db.workspaceMember.findFirst({
      where: { userId, workspaceId, status: "active", workspace: { status: "active" } },
      include: { workspace: true },
    })
    if (!member) throw dependencies.errors.forbidden("Not a member of the requested workspace", { workspaceId })
    return member.workspace
  }

  const memberships = await db.workspaceMember.findMany({
    where: { userId, status: "active", workspace: { status: "active" } },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  })
  if (memberships.length > 1) {
    throw dependencies.errors.badRequest("Multiple workspace memberships; workspace must be specified explicitly", { userId })
  }
  if (memberships.length === 1) return memberships[0].workspace
  return buildWorkspace(userId, email, useDefaultBootstrap, approvedWorkspaceId)
}

async function localReviewActor(dependencies: AccessDependencies): Promise<AccessActor> {
  const workspace = await db.workspace.findUnique({
    where: { id: "default-workspace" },
    select: { id: true, name: true, ownerUserId: true },
  })
  if (!workspace) throw dependencies.errors.unauthorized("Local review workspace is missing")
  const user = workspace.ownerUserId
    ? await db.user.findUnique({ where: { id: workspace.ownerUserId }, select: { id: true, email: true } })
    : await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, email: true } })
  if (!user) throw dependencies.errors.unauthorized("Local review user is missing")
  return {
    userId: user.id,
    email: user.email,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    scopes: ["*"],
    actor: { type: "user", id: user.id, label: `${user.email} (local review)`, workspaceId: workspace.id },
  }
}

async function buildWorkspace(userId: string, email: string, useDefault: boolean, approvedWorkspaceId: string | null) {
  const workspaceId = useDefault ? "default-workspace" : approvedWorkspaceId
  const workspace = workspaceId
    ? await db.workspace.upsert({
      where: { id: workspaceId },
      update: useDefault ? { ownerUserId: userId } : {},
      create: {
        id: workspaceId,
        name: useDefault ? "Joseph's Life OS" : `${displayNameFromEmail(email)}'s Life OS`,
        slug: useDefault ? "joseph-life-os" : uniqueWorkspaceSlug(email),
        ownerUserId: userId,
      },
    })
    : await db.workspace.create({
      data: {
        name: `${displayNameFromEmail(email)}'s Life OS`,
        slug: uniqueWorkspaceSlug(email),
        ownerUserId: userId,
      },
    })
  await addWorkspaceMember(workspace.id, userId, "owner")
  return workspace
}

async function addWorkspaceMember(workspaceId: string, userId: string, role: WorkspaceRole) {
  return db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    update: { role, status: "active" },
    create: { workspaceId, userId, role, status: "active" },
  })
}

async function grantRole(userId: string, roleKey: string) {
  const role = await db.role.findUnique({ where: { key: roleKey }, select: { id: true } })
  if (!role) return
  await db.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id },
  })
}

async function userScopes(userId: string) {
  const rows = await db.userRole.findMany({
    where: { userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  })
  return [...new Set(rows.flatMap(row => row.role.permissions.map(item => item.permission.scope)))].sort()
}

function hasScope(scopes: string[], requiredScope: string) {
  return scopes.includes("*") || scopes.includes(requiredScope)
}

function isLocalReviewEnabled(dependencies: AccessDependencies) {
  return dependencies.localReviewEnabled?.()
    ?? (process.env.NODE_ENV !== "production" && process.env.LIFE_OS_LOCAL_REVIEW === "1")
}

function ownerEmails() {
  return [process.env.OWNER_EMAILS, process.env.ADMIN_EMAILS]
    .filter(Boolean)
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

export * from "./api-key"
