import test, { after } from "node:test"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { createTestDatabase, type TestDatabase } from "@life-os/db/testing"

process.env.ALLOWED_EMAILS = [
  "disabled@example.com",
  "multi@example.com",
  "viewer@example.com",
  "cache@example.com",
].join(",")

type Modules = {
  access: typeof import("../index")
  admin: typeof import("../admin")
  db: typeof import("@life-os/db")["db"]
}

let modulesPromise: Promise<Modules> | null = null
let testDb: TestDatabase | null = null

async function setup() {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      testDb = await createTestDatabase()
      const [access, admin, dbModule] = await Promise.all([import("../index"), import("../admin"), import("@life-os/db")])
      return { access, admin, db: dbModule.db }
    })()
  }
  return modulesPromise
}

after(async () => {
  await testDb?.drop()
})

function fakeActor(overrides: Partial<import("../index").AccessActor> & { workspaceId: string; userId: string }): import("../index").AccessActor {
  return {
    email: "actor@example.com",
    workspaceName: "Test",
    scopes: ["*"],
    actor: { type: "user", id: overrides.userId, label: overrides.email ?? "actor@example.com", workspaceId: overrides.workspaceId },
    ...overrides,
  }
}

function service(access: Modules["access"], email: string) {
  return access.createAccessService({
    getSession: async () => ({ user: { email, name: "Access Test", image: null } }),
    errors: {
      badRequest: (message, details) => Object.assign(new Error(message), { status: 400, details }),
      forbidden: (message = "Forbidden", details) => Object.assign(new Error(message), { status: 403, details }),
      unauthorized: (message = "Unauthorized", details) => Object.assign(new Error(message), { status: 401, details }),
    },
    localReviewEnabled: () => false,
  })
}

async function createWorkspace(db: Modules["db"], id: string) {
  return db.workspace.create({ data: { id, name: id, slug: id } })
}

async function createMember(db: Modules["db"], input: { email: string; workspaceId: string; status?: string }) {
  const user = await db.user.create({
    data: { email: input.email, status: input.status ?? "active" },
  })
  await db.workspaceMember.create({
    data: { workspaceId: input.workspaceId, userId: user.id, role: "viewer", status: "active" },
  })
  return user
}

async function grantRole(db: Modules["db"], userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } })
  await db.userRole.create({ data: { userId, roleId: role.id } })
}

async function createApiKey(db: Modules["db"], workspaceId: string, scopes: string[]) {
  const plaintext = `test_${randomUUID()}`
  const keyHash = createHash("sha256").update(plaintext).digest("hex")
  const apiKey = await db.apiKey.create({
    data: {
      workspaceId,
      name: "test key",
      keyPrefix: plaintext.slice(0, 12),
      keyHash,
      status: "active",
      scopes: { create: scopes.map(scope => ({ scope })) },
    },
  })
  return { ...apiKey, plaintext }
}

test("disabled users stay disabled and cannot be resurrected by an access check", async () => {
  const { access, db } = await setup()
  await createWorkspace(db, "access-disabled")
  const user = await createMember(db, {
    email: "disabled@example.com",
    workspaceId: "access-disabled",
    status: "disabled",
  })

  await assert.rejects(
    () => service(access, user.email).requireAccess("people.read", "access-disabled"),
    /disabled/i,
  )
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status, "disabled")
})

test("multiple memberships require an explicit workspace", async () => {
  const { access, db } = await setup()
  await createWorkspace(db, "access-multi-a")
  await createWorkspace(db, "access-multi-b")
  const user = await createMember(db, { email: "multi@example.com", workspaceId: "access-multi-a" })
  await db.workspaceMember.create({
    data: { workspaceId: "access-multi-b", userId: user.id, role: "viewer", status: "active" },
  })

  await assert.rejects(
    () => service(access, user.email).requireAccess("people.read"),
    /multiple workspace memberships/i,
  )
})

test("an explicit workspace must belong to the current user", async () => {
  const { access, db } = await setup()
  await createWorkspace(db, "access-owned")
  await createWorkspace(db, "access-foreign")
  const user = await createMember(db, { email: "viewer@example.com", workspaceId: "access-owned" })
  const accessService = service(access, user.email)
  await accessService.seedDefaultAccess()
  await grantRole(db, user.id, "viewer")

  await assert.rejects(
    () => accessService.requireAccess("people.read", "access-foreign"),
    /not a member/i,
  )
})

test("viewer scopes permit reads and reject writes", async () => {
  const { access, db } = await setup()
  const accessService = service(access, "viewer@example.com")
  const actor = await accessService.requireAccess("people.read", "access-owned")
  assert.equal(actor.workspaceId, "access-owned")
  assert.ok(actor.scopes.includes("people.read"))

  await assert.rejects(
    () => accessService.requireAccess("people.write", "access-owned"),
    /missing required permission/i,
  )
})

test("a suspended workspace blocks its sole member rather than provisioning a replacement", async () => {
  const { access, db } = await setup()
  await createWorkspace(db, "access-suspend-target")
  const user = await createMember(db, { email: "suspend@example.com", workspaceId: "access-suspend-target" })
  await db.approvedEmail.create({ data: { email: user.email, status: "approved" } })
  const accessService = service(access, user.email)
  await accessService.seedDefaultAccess()
  await grantRole(db, user.id, "viewer")

  // Confirm sign-in works before suspension.
  const before = await accessService.requireAccess("people.read")
  assert.equal(before.workspaceId, "access-suspend-target")

  await db.workspace.update({ where: { id: "access-suspend-target" }, data: { status: "suspended" } })

  await assert.rejects(
    () => service(access, user.email).requireAccess("people.read"),
    /suspended/i,
  )
  // Blocked, not silently reprovisioned: no second workspace was created for this user.
  const memberships = await db.workspaceMember.findMany({ where: { userId: user.id } })
  assert.equal(memberships.length, 1)
})

test("a returning user with no workspace membership gets owner scopes on the new workspace it's provisioned into", async () => {
  const { access, db } = await setup()
  // Simulate a user who already has a User row (not their first-ever
  // sign-in) but was never actually added to any workspace — e.g. a prior
  // provisioning attempt that never completed. isFirstUser would be false
  // here, so without buildWorkspace's own grantRole call this user would
  // get a workspace and then 403 on every request inside it.
  const user = await db.user.create({ data: { email: "orphaned@example.com", status: "active" } })
  await db.approvedEmail.create({ data: { email: user.email, status: "approved", workspaceId: null } })

  const actor = await service(access, user.email).requireAccess("people.read")
  assert.ok(actor.scopes.includes("*"))
  assert.notEqual(actor.workspaceId, "default-workspace")
})

test("a brand-new standalone signup gets its own workspace, not default-workspace", async () => {
  const { access, db } = await setup()
  // This is the actual production bug: isFirstUser used to mean "this email
  // has no User row yet," which is true for every new signup forever, not
  // just the literal first account on the instance. By this point in the
  // suite other tests have already created users, so db.user.count() > 0 —
  // this email must NOT be treated as the bootstrap user.
  assert.ok((await db.user.count()) > 0, "sanity check: earlier tests already created users")
  await db.approvedEmail.create({ data: { email: "standalone-signup@example.com", status: "approved", workspaceId: null } })

  const actor = await service(access, "standalone-signup@example.com").requireAccess("people.read")
  assert.notEqual(actor.workspaceId, "default-workspace")
  assert.ok(actor.scopes.includes("*"))
})

test("a shared-workspace invite receives Viewer from its first request without an Owner window", async () => {
  const { access, db } = await setup()
  const workspaceId = "access-shared-invite"
  await createWorkspace(db, workspaceId)
  const accessService = service(access, "shared-viewer@example.com")
  await accessService.seedDefaultAccess()
  const viewer = await db.role.findUniqueOrThrow({ where: { key: "viewer" } })
  await db.approvedEmail.create({
    data: { email: "shared-viewer@example.com", status: "approved", workspaceId, roleId: viewer.id },
  })

  const actor = await accessService.requireAccess("people.read")
  assert.equal(actor.workspaceId, workspaceId)
  assert.equal(actor.scopes.includes("*"), false)
  await assert.rejects(() => service(access, actor.email).requireAccess("settings.manage"), /missing required permission/i)

  const user = await db.user.findUniqueOrThrow({
    where: { email: actor.email },
    include: { roles: { include: { role: true } }, workspaceMemberships: true },
  })
  assert.deepEqual(user.roles.map(item => item.role.key), ["viewer"])
  assert.equal(user.workspaceMemberships[0]?.role, "viewer")
})

test("shared invitations default to Viewer and reject Owner as an invite role", async () => {
  const { access, admin, db } = await setup()
  const workspaceId = "access-invite-policy"
  const owner = await db.user.create({ data: { email: "invite-owner@example.com", status: "active" } })
  await db.workspace.create({ data: { id: workspaceId, name: workspaceId, slug: workspaceId, ownerUserId: owner.id } })
  const accessService = service(access, owner.email)
  await accessService.seedDefaultAccess()
  const actor = fakeActor({ userId: owner.id, workspaceId })

  const created = await admin.addApprovedEmail({ email: "default-viewer-invite@example.com" }, actor)
  assert.equal(created.approvedEmail.role?.key, "viewer")

  const ownerRole = await db.role.findUniqueOrThrow({ where: { key: "owner" } })
  await assert.rejects(
    () => admin.addApprovedEmail({ email: "forbidden-owner-invite@example.com", roleId: ownerRole.id }, actor),
    /other than Owner/i,
  )
})

test("workspace admins can promote their member to Admin but cannot assign Owner", async () => {
  const { access, admin, db } = await setup()
  const workspaceId = "access-role-promotion"
  const owner = await db.user.create({ data: { email: "promotion-owner@example.com", status: "active" } })
  await db.workspace.create({ data: { id: workspaceId, name: workspaceId, slug: workspaceId, ownerUserId: owner.id } })
  await db.workspaceMember.create({ data: { workspaceId, userId: owner.id, role: "owner" } })
  const accessService = service(access, owner.email)
  await accessService.seedDefaultAccess()
  await grantRole(db, owner.id, "owner")
  const member = await createMember(db, { email: "promoted-member@example.com", workspaceId })
  await grantRole(db, member.id, "viewer")
  const actor = fakeActor({ userId: owner.id, workspaceId })
  const adminRole = await db.role.findUniqueOrThrow({ where: { key: "admin" } })

  await admin.updateUserRoles(member.id, { roleIds: [adminRole.id] }, actor)
  const promoted = await db.workspaceMember.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId, userId: member.id } },
  })
  assert.equal(promoted.role, "admin")

  const ownerRole = await db.role.findUniqueOrThrow({ where: { key: "owner" } })
  await assert.rejects(
    () => admin.updateUserRoles(member.id, { roleIds: [ownerRole.id] }, actor),
    /cannot be assigned/i,
  )
})

test("non-owner admins cannot manufacture or grant unrestricted access", async () => {
  const { access, admin, db } = await setup()
  const workspaceId = "access-wildcard-policy"
  const owner = await db.user.create({ data: { email: "wildcard-owner@example.com", status: "active" } })
  const adminUser = await db.user.create({ data: { email: "wildcard-admin@example.com", status: "active" } })
  await db.workspace.create({ data: { id: workspaceId, name: workspaceId, slug: workspaceId, ownerUserId: owner.id } })
  await db.workspaceMember.createMany({
    data: [
      { workspaceId, userId: owner.id, role: "owner" },
      { workspaceId, userId: adminUser.id, role: "admin" },
    ],
  })
  await service(access, owner.email).seedDefaultAccess()
  const adminActor = fakeActor({ userId: adminUser.id, workspaceId, scopes: ["roles.manage", "apiKeys.manage"] })

  await assert.rejects(
    () => admin.createRole({ key: "admin-escalation", name: "Escalation", scopes: ["*"] }, adminActor),
    /workspace owner/i,
  )
  await assert.rejects(
    () => admin.createApiKey({ name: "unrestricted", scopes: ["*"] }, adminActor),
    /workspace owner/i,
  )

  const unrestricted = await admin.createRole(
    { key: "owner-delegated-unrestricted", name: "Owner delegated unrestricted", scopes: ["*"] },
    fakeActor({ userId: owner.id, workspaceId }),
  )
  await assert.rejects(
    () => admin.updateUserRoles(adminUser.id, { roleIds: [unrestricted.id] }, adminActor),
    /workspace owner/i,
  )
})

test("the built-in Owner role is immutable", async () => {
  const { admin, db } = await setup()
  const ownerRole = await db.role.findUniqueOrThrow({ where: { key: "owner" } })
  await assert.rejects(
    () => admin.updateRole(ownerRole.id, { name: "Changed Owner" }, fakeActor({ userId: "any-owner", workspaceId: "any-workspace" })),
    /cannot be edited/i,
  )
})

test("role management cannot target a user outside the actor's workspace", async () => {
  const { access, admin, db } = await setup()
  await createWorkspace(db, "access-role-scope-a")
  await createWorkspace(db, "access-role-scope-b")
  const actorUser = await createMember(db, { email: "role-scope-admin@example.com", workspaceId: "access-role-scope-a" })
  const foreignUser = await createMember(db, { email: "role-scope-foreign@example.com", workspaceId: "access-role-scope-b" })
  const accessService = service(access, actorUser.email)
  await accessService.seedDefaultAccess()
  const viewer = await db.role.findUniqueOrThrow({ where: { key: "viewer" } })

  await assert.rejects(
    () => admin.updateUserRoles(foreignUser.id, { roleIds: [viewer.id] }, fakeActor({ userId: actorUser.id, workspaceId: "access-role-scope-a" })),
    /workspace member not found/i,
  )
})

test("only the instance owner (default-workspace) can suspend another workspace", async () => {
  const { admin, db } = await setup()
  await createWorkspace(db, "access-owner-target")
  await createWorkspace(db, "access-owner-outsider-home")
  const outsider = await createMember(db, { email: "outsider@example.com", workspaceId: "access-owner-outsider-home" })

  await assert.rejects(
    () => admin.updateWorkspaceStatus("access-owner-target", { status: "suspended" }, fakeActor({ userId: outsider.id, workspaceId: "access-owner-outsider-home" })),
    /instance owner/i,
  )
})

test("the instance owner's own default workspace cannot be suspended", async () => {
  const { admin, db } = await setup()
  const owner = await db.user.create({ data: { email: "owner-self@example.com", status: "active" } })

  await assert.rejects(
    () => admin.updateWorkspaceStatus("default-workspace", { status: "suspended" }, fakeActor({ userId: owner.id, workspaceId: "default-workspace" })),
    /cannot be suspended/i,
  )
})

test("the instance owner can suspend and reactivate another workspace", async () => {
  const { admin, db } = await setup()
  await createWorkspace(db, "access-suspendable")
  const owner = await db.user.create({ data: { email: "owner-suspend@example.com", status: "active" } })
  const actor = fakeActor({ userId: owner.id, workspaceId: "default-workspace" })

  const suspended = await admin.updateWorkspaceStatus("access-suspendable", { status: "suspended" }, actor)
  assert.equal(suspended.workspace.status, "suspended")
  const reactivated = await admin.updateWorkspaceStatus("access-suspendable", { status: "active" }, actor)
  assert.equal(reactivated.workspace.status, "active")
})

test("cache entries remain isolated by explicit workspace", async () => {
  const { access, db } = await setup()
  await createWorkspace(db, "access-cache-a")
  await createWorkspace(db, "access-cache-b")
  const user = await createMember(db, { email: "cache@example.com", workspaceId: "access-cache-a" })
  await db.workspaceMember.create({
    data: { workspaceId: "access-cache-b", userId: user.id, role: "viewer", status: "active" },
  })
  const accessService = service(access, user.email)
  await accessService.seedDefaultAccess()
  await grantRole(db, user.id, "viewer")

  const first = await accessService.requireAccess("people.read", "access-cache-a")
  const second = await accessService.requireAccess("people.read", "access-cache-b")
  assert.equal(first.workspaceId, "access-cache-a")
  assert.equal(second.workspaceId, "access-cache-b")
})

test("a key with workspace.proxy can act on a caller-specified active workspace", async () => {
  const { access, db } = await setup()
  await createWorkspace(db, "proxy-key-home-a")
  await createWorkspace(db, "proxy-target-active")
  const key = await createApiKey(db, "proxy-key-home-a", ["interactions.read", "workspace.proxy"])

  const result = await access.authorizeApiKey(key.plaintext, "interactions.read", "proxy-target-active")
  assert.equal(result?.workspaceId, "proxy-target-active")
})

test("workspace.proxy override is ignored for a suspended target workspace", async () => {
  const { access, db } = await setup()
  await createWorkspace(db, "proxy-key-home-b")
  await db.workspace.create({ data: { id: "proxy-target-suspended", name: "x", slug: "proxy-target-suspended", status: "suspended" } })
  const key = await createApiKey(db, "proxy-key-home-b", ["interactions.read", "workspace.proxy"])

  const result = await access.authorizeApiKey(key.plaintext, "interactions.read", "proxy-target-suspended")
  assert.equal(result?.workspaceId, "proxy-key-home-b")
})

test("a key without workspace.proxy cannot override its own workspace", async () => {
  const { access, db } = await setup()
  await createWorkspace(db, "proxy-key-home-c")
  await createWorkspace(db, "proxy-target-unauthorized")
  const key = await createApiKey(db, "proxy-key-home-c", ["interactions.read"])

  const result = await access.authorizeApiKey(key.plaintext, "interactions.read", "proxy-target-unauthorized")
  assert.equal(result?.workspaceId, "proxy-key-home-c")
})
