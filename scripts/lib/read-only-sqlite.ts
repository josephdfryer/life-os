import { existsSync } from "node:fs"
import { createRequire } from "node:module"

type SqliteParameter = null | number | bigint | string | Uint8Array

export type ReadOnlySqliteDatabase = {
  prepare<TResult>(sql: string): {
    all(...params: SqliteParameter[]): TResult[]
    get(...params: SqliteParameter[]): TResult | undefined
  }
  close(): void
}

const require = createRequire(import.meta.url)
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (
    filename: string,
    options: { readOnly: boolean },
  ) => ReadOnlySqliteDatabase
}

/**
 * Open a source database without a native npm addon and without write access.
 * Node 22+ ships SQLite itself, which keeps the Mac collectors working when
 * Homebrew advances Node to a new native-module ABI.
 */
export function openReadOnlySqlite(filename: string): ReadOnlySqliteDatabase {
  if (!existsSync(filename)) throw new Error("database file does not exist")
  return new DatabaseSync(filename, { readOnly: true })
}
