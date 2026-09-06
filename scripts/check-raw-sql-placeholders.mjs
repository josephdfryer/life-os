#!/usr/bin/env node

// Fail CI if a raw SQL call uses SQLite-style `?` positional placeholders.
//
// The database is Postgres (Neon). Its driver binds parameters as `$1`, `$2`,
// … — it does not understand `?`, and parses `= ?` as an operator token, so the
// next keyword blows up with `42601 syntax error`. This is exactly how
// `scripts/era/rederive-actor-attribution.ts` failed every `era-auto-sync` run
// for days after the SQLite → Postgres migration: the scripts were never ported.
// A grep is cheap and a typecheck can never catch it, so gate it here.

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const roots = ["scripts", "packages", "apps"].map(d => join(root, d))
const skipDirs = new Set(["node_modules", "generated", ".next", "dist", "build", ".turbo"])

// Known-broken, tracked separately. Each entry needs a reason and an owner.
// Do NOT add to this list to silence a fresh mistake — fix the `?` instead.
const KNOWN_EXCEPTIONS = new Map([
  [
    "scripts/check-raw-sql-placeholders.mjs",
    "this gate's own regex source",
  ],
  [
    "packages/files/src/queries.ts",
    "SQLite FTS5 module (FileChunkFts MATCH, bm25()) — never ported to Postgres; needs a tsvector/pg_trgm rewrite, tracked as a separate task",
  ],
])

/** @type {string[]} */
const files = []
for (const start of roots) {
  const stack = [start]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) stack.push(join(dir, entry.name))
      } else if (/\.(ts|tsx|mts|cts|js|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        files.push(join(dir, entry.name))
      }
    }
  }
}

// The first argument to a raw-SQL call: `$queryRawUnsafe(`, `$executeRawUnsafe(`,
// and the tagged-template forms. Capture the string/template that follows.
const CALL = /\$(?:query|execute)Raw(?:Unsafe)?\s*(?:<[^>]*>)?\s*\(?\s*(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g
// A `?` used as a bound parameter: after `=`, `,`, `(`, a comparison operator,
// or inside `IN (...)`. Ignores `??`, `?.`, and `? :` ternaries.
const PLACEHOLDER = /(?:[=,(]|<=|>=|<>|!=|\bIN\s*\()\s*\?(?!\?|\.)/i

const problems = []
const staleExceptions = new Set(KNOWN_EXCEPTIONS.keys())
for (const file of files) {
  const rel = relative(root, file)
  const src = readFileSync(file, "utf8")
  let hit = false
  let match
  while ((match = CALL.exec(src)) !== null) {
    const sql = match[1]
    if (!PLACEHOLDER.test(sql)) continue
    hit = true
    if (KNOWN_EXCEPTIONS.has(rel)) continue
    const line = src.slice(0, match.index).split("\n").length
    problems.push(
      `${rel}:${line} — raw SQL uses a \`?\` placeholder. Postgres binds parameters as $1, $2, …`,
    )
  }
  if (hit) staleExceptions.delete(rel)
}

for (const rel of staleExceptions) {
  problems.push(`${rel} is in KNOWN_EXCEPTIONS but no longer has a \`?\` placeholder — remove the exception.`)
}

if (problems.length) {
  console.error(
    `Raw SQL placeholder problems (${problems.length}):\n${problems.map(p => `- ${p}`).join("\n")}`,
  )
  process.exitCode = 1
} else {
  console.log("Raw SQL placeholders: ok (no SQLite-style `?` params)")
}
