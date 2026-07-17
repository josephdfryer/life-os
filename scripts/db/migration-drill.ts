import { copyFileSync, existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const Database = require("better-sqlite3")
const root = process.cwd()
const sourcePath = "/private/tmp/life-os-migration-drill.db"
const backupPath = "/private/tmp/life-os-migration-drill.backup.db"
const restoredPath = "/private/tmp/life-os-migration-drill.restored.db"
const migrationsRoot = join(root, "packages/db/prisma/migrations")
const upgradeStart = "20260714130000_money_as_cents"

for (const path of [sourcePath, backupPath, restoredPath]) {
  if (existsSync(path)) unlinkSync(path)
}

const migrations = readdirSync(migrationsRoot)
  .filter(name => name !== "migration_lock.toml")
  .sort()

function apply(db: InstanceType<typeof Database>, names: string[]) {
  for (const name of names) {
    db.exec(readFileSync(join(migrationsRoot, name, "migration.sql"), "utf8"))
  }
}

function verify(db: InstanceType<typeof Database>) {
  const interaction = db.prepare("SELECT amount FROM Interaction WHERE id = ?").get("drill-interaction") as { amount: number }
  const item = db.prepare("SELECT purchasePrice FROM Item WHERE id = ?").get("drill-item") as { purchasePrice: number }
  if (interaction.amount !== 1234 || item.purchasePrice !== 9876) {
    throw new Error(`Money conversion failed: ${JSON.stringify({ interaction, item })}`)
  }
  const foreignKeyFailures = db.pragma("foreign_key_check") as unknown[]
  if (foreignKeyFailures.length) {
    throw new Error(`Foreign-key verification failed: ${JSON.stringify(foreignKeyFailures)}`)
  }
  const integrity = db.pragma("integrity_check", { simple: true })
  if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity}`)
}

const split = migrations.indexOf(upgradeStart)
if (split < 1) throw new Error(`Could not find upgrade boundary ${upgradeStart}`)

const db = new Database(sourcePath)
db.pragma("foreign_keys = ON")
apply(db, migrations.slice(0, split))
db.exec(`
  INSERT INTO Person (id, workspaceId, createdAt, updatedAt, first, last, emails, phones, closeness, tags, "values")
  VALUES ('drill-person', 'default-workspace', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Migration', 'Fixture', '[]', '[]', 5, '[]', '[]');
  INSERT INTO Interaction (id, workspaceId, createdAt, personId, type, timestamp, billable, amount)
  VALUES ('drill-interaction', 'default-workspace', CURRENT_TIMESTAMP, 'drill-person', 'call', CURRENT_TIMESTAMP, 1, 12.34);
  INSERT INTO Item (id, workspaceId, createdAt, updatedAt, name, assetId, quantity, purchasePrice, lifetimeWarranty)
  VALUES ('drill-item', 'default-workspace', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Fixture Item', 'drill-asset', 1, 98.76, 0);
`)
apply(db, migrations.slice(split))
verify(db)
db.close()

copyFileSync(sourcePath, backupPath)
copyFileSync(backupPath, restoredPath)
const restored = new Database(restoredPath, { readonly: true })
verify(restored)
restored.close()

console.log(`Migration and restore drill passed (${migrations.length} migrations, isolated synthetic data)`)
