import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { openReadOnlySqlite } from "./read-only-sqlite"

const require = createRequire(import.meta.url)
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (filename: string) => {
    exec(sql: string): void
    close(): void
  }
}

test("opens an existing SQLite source through the Node runtime", t => {
  const root = mkdtempSync(join(tmpdir(), "life-os-readonly-sqlite-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const filename = join(root, "source.sqlite")
  const writable = new DatabaseSync(filename)
  writable.exec("CREATE TABLE message (id INTEGER PRIMARY KEY); INSERT INTO message VALUES (42)")
  writable.close()

  const readonly = openReadOnlySqlite(filename)
  t.after(() => readonly.close())
  assert.equal(readonly.prepare<{ id: number }>("SELECT id FROM message").get()?.id, 42)
})

test("refuses to create a missing source database", () => {
  assert.throws(
    () => openReadOnlySqlite(join(tmpdir(), "life-os-source-does-not-exist.sqlite")),
    /database file does not exist/,
  )
})
