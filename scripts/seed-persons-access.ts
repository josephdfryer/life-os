import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import dotenv from "dotenv"
import { createClient } from "@libsql/client"

const permissions = [
  ["*", "Full system access"],
  ["people.read", "Read people records"],
  ["people.write", "Create and update people"],
  ["interactions.read", "Read interactions"],
  ["interactions.write", "Create and update interactions"],
  ["inbox.review", "Review and resolve automation inbox items"],
  ["ingest.write", "Run headless ingest/import flows"],
  ["files.read", "Read imported source files"],
  ["audit.read", "Read audit log entries"],
  ["apiKeys.manage", "Create, update, and revoke API keys"],
  ["roles.manage", "Create and update roles"],
  ["permissions.manage", "Manage permission assignments"],
  ["settings.manage", "Manage application settings"],
  ["rules.manage", "Manage rules engine configuration"],
  ["automations.manage", "Manage automation definitions"],
] as const

const roles = [
  ["owner", "Owner", "Full access, including access and settings management.", ["*"]],
  ["admin", "Admin", "Operational admin access without ownership transfer semantics.", [
    "people.read", "people.write",
    "interactions.read", "interactions.write",
    "inbox.review", "ingest.write", "files.read",
    "audit.read", "apiKeys.manage", "roles.manage", "permissions.manage",
    "settings.manage", "rules.manage", "automations.manage",
  ]],
  ["editor", "Editor", "Day-to-day CRM editing access.", [
    "people.read", "people.write",
    "interactions.read", "interactions.write",
    "inbox.review", "ingest.write", "files.read",
  ]],
  ["viewer", "Viewer", "Read-only CRM access.", ["people.read", "interactions.read", "files.read"]],
  ["automation", "Automation", "Machine access for ingest and inbox workflows.", [
    "people.read", "interactions.read", "interactions.write", "inbox.review", "ingest.write", "files.read",
  ]],
] as const

const envPath = path.join(process.cwd(), "apps/persons/.env")
const env = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {}
const url = process.env.TURSO_DATABASE_URL ?? env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN ?? env.TURSO_AUTH_TOKEN

if (!url) {
  throw new Error("TURSO_DATABASE_URL is required")
}

const client = createClient({ url, authToken })

async function main() {
  for (const [scope, description] of permissions) {
    await client.execute({
      sql: `
        INSERT INTO Permission (id, createdAt, scope, description)
        VALUES (?, CURRENT_TIMESTAMP, ?, ?)
        ON CONFLICT(scope) DO UPDATE SET description = excluded.description
      `,
      args: [randomUUID(), scope, description],
    })
  }

  for (const [key, name, description, scopes] of roles) {
    await client.execute({
      sql: `
        INSERT INTO Role (id, createdAt, updatedAt, key, name, description)
        VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          updatedAt = CURRENT_TIMESTAMP,
          name = excluded.name,
          description = excluded.description
      `,
      args: [randomUUID(), key, name, description],
    })

    const role = await client.execute({ sql: "SELECT id FROM Role WHERE key = ?", args: [key] })
    const roleId = String(role.rows[0].id)

    for (const scope of scopes) {
      const permission = await client.execute({ sql: "SELECT id FROM Permission WHERE scope = ?", args: [scope] })
      if (!permission.rows[0]) continue
      await client.execute({
        sql: `
          INSERT OR IGNORE INTO RolePermission (roleId, permissionId)
          VALUES (?, ?)
        `,
        args: [roleId, String(permission.rows[0].id)],
      })
    }
  }

  const roleCount = await client.execute("SELECT COUNT(*) AS count FROM Role")
  const permissionCount = await client.execute("SELECT COUNT(*) AS count FROM Permission")
  console.log(`Seeded ${permissionCount.rows[0].count} permissions and ${roleCount.rows[0].count} roles`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
