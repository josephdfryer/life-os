import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url))
const dbPackageRoot = join(repoRoot, "packages/db")
const require = createRequire(import.meta.url)
const dbDir = mkdtempSync(join(tmpdir(), "life-os-access-"))
const dbPath = join(dbDir, "access.db")

process.env.DATABASE_URL = `file:${dbPath}`
process.env.TURSO_DATABASE_URL = ""
process.env.TURSO_AUTH_TOKEN = ""
process.env.ALLOWED_EMAILS = [
  "disabled@example.com",
  "multi@example.com",
  "viewer@example.com",
  "cache@example.com",
].join(",")

type Modules = {
  access: typeof import("../index")
  db: typeof import("@life-os/db")["db"]
}

let modulesPromise: Promise<Modules> | null = null

async function setup() {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      applyMigrations(dbPath)
      const [access, dbModule] = await Promise.all([import("../index"), import("@life-os/db")])
      return { access, db: dbModule.db }
    })()
  }
  return modulesPromise
}

function applyMigrations(path: string) {
  const Database = require("better-sqlite3")
  const sqlite = new Database(path)
  sqlite.pragma("foreign_keys = OFF")
  const migrationsDir = join(dbPackageRoot, "prisma/migrations")
  for (const dirname of readdirSync(migrationsDir).filter(name => name !== "migration_lock.toml").sort()) {
    sqlite.exec(readFileSync(join(migrationsDir, dirname, "migration.sql"), "utf8"))
  }
  sqlite.pragma("foreign_keys = ON")
  sqlite.close()
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
