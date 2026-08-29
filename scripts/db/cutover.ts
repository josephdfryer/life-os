#!/usr/bin/env tsx
// Turso -> PostgreSQL cutover helpers. Two subcommands, both read-only:
//
//   tsx scripts/db/cutover.ts preflight   — is everything staged for the window?
//   tsx scripts/db/cutover.ts verify      — after the final ETL, does Neon match Turso?
//
// The destructive steps (DROP SCHEMA on Neon, purge on Turso, env flip, deploy)
// are NOT in here on purpose — they live in docs/DATABASE_CUTOVER_RUNBOOK.md as
// commands you run and approve yourself. This script only tells you whether it
// is safe to run the next one.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createClient as createTurso } from "@libsql/client"
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pg = require("pg") as typeof import("pg")

// Prisma stores `DateTime` as `timestamp without time zone` (OID 1114) holding
// a UTC instant. Raw node-postgres would parse that using the Node process's
// local timezone and shift it — which looks like a migration bug but is only a
// read artifact. Force UTC so the comparison against Turso (whose text
// timestamps are already UTC) is apples-to-apples.
pg.types.setTypeParser(1114, (v: string) => new Date(v.replace(" ", "T") + "Z"))

const ROOT = path.resolve(import.meta.dirname, "../..")
const SCHEMA = path.join(ROOT, "packages/db/prisma/schema.sqlite.prisma")
const BRANCH = "codex/postgres-migration"

function loadEnv() {
  for (const file of [".env", "apps/persons/.env", ".env.local"]) {
    const full = path.join(ROOT, file)
    if (!fs.existsSync(full)) continue
    for (const line of fs.readFileSync(full, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
    }
  }
}

function modelNames(): string[] {
  const src = fs.readFileSync(SCHEMA, "utf8")
  return [...src.matchAll(/\bmodel\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g)].map((m) => m[1])
}

function tursoClient() {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) throw new Error("TURSO_DATABASE_URL not found (apps/persons/.env)")
  return createTurso({ url, authToken: process.env.TURSO_AUTH_TOKEN })
}

function neonClient() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.TARGET_DATABASE_URL
  if (!url || !/^postgres/.test(url)) throw new Error("DATABASE_URL_UNPOOLED not found (.env.local)")
  return new pg.Client({ connectionString: url })
}

const ok = (m: string) => console.log(`  ok    ${m}`)
const warn = (m: string) => console.log(`  warn  ${m}`)
let failures = 0
const fail = (m: string) => {
  failures++
  console.log(`  FAIL  ${m}`)
}

async function preflight() {
  console.log("Preflight — cutover readiness\n")

  // 1. Git state
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" }).trim()
  branch === BRANCH ? ok(`on branch ${BRANCH}`) : fail(`on branch ${branch}, expected ${BRANCH}`)
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim()
  dirty ? warn(`working tree has ${dirty.split("\n").length} uncommitted change(s)`) : ok("working tree clean")

  // 2. .env.shared has Neon, not Turso
  const sharedPath = path.join(ROOT, ".env.shared")
  if (!fs.existsSync(sharedPath)) {
    fail(".env.shared missing — scripts/sync-vercel-env.ts needs it to fan out DATABASE_URL")
  } else {
    const shared = fs.readFileSync(sharedPath, "utf8")
    const has = (re: RegExp) => re.test(shared)
    if (has(/^\s*DATABASE_URL\s*=/m)) ok(".env.shared sets DATABASE_URL")
    else fail(".env.shared has no DATABASE_URL")
    if (has(/^\s*DATABASE_URL_UNPOOLED\s*=/m)) ok(".env.shared sets DATABASE_URL_UNPOOLED")
    else fail(".env.shared has no DATABASE_URL_UNPOOLED")
    if (has(/neon\.tech/)) ok(".env.shared DATABASE_URL points at neon.tech")
    else warn(".env.shared: no neon.tech host seen")
    if (has(/^\s*TURSO_DATABASE_URL\s*=/m)) {
      fail(".env.shared still sets TURSO_DATABASE_URL — remove it so the fan-out drops it everywhere")
    } else {
      ok(".env.shared no longer sets TURSO_DATABASE_URL")
    }
  }

  // 3. Neon reachable + migration state
  const neon = neonClient()
  try {
    await neon.connect()
    const t = await neon.query(
      `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
    )
    ok(`Neon reachable — ${t.rows[0].n} tables in public`)
    try {
      execFileSync("npx", ["prisma", "migrate", "status", "--schema", "prisma/schema.prisma"], {
        cwd: path.join(ROOT, "packages/db"),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      ok("Neon migrate status: up to date")
    } catch {
      warn("Neon migrate status: not up to date (expected if you have not run `migrate deploy` on a fresh schema yet)")
    }
  } finally {
    await neon.end()
  }

  // 4. Turso reachable + size
  const turso = tursoClient()
  try {
    const r = await turso.execute(`SELECT count(*) n FROM "Person"`)
    ok(`Turso reachable — ${Number(r.rows[0].n)} Person rows`)
    const orphans = await turso.execute(
      `SELECT count(*) n FROM "Person" WHERE workspaceId NOT IN (SELECT id FROM "Workspace")`,
    )
    const o = Number(orphans.rows[0].n)
    o === 0
      ? ok("Turso: no orphaned Person rows (residue purge already run)")
      : warn(`Turso: ${o} orphaned Person rows — run scripts/db/purge-turso-test-residue.ts --execute in the window`)
  } finally {
    turso.close()
  }

  console.log(`\n${failures ? `${failures} blocker(s) — resolve before the window.` : "Ready. Proceed to the window."}`)
  process.exit(failures ? 1 : 0)
}

async function verify() {
  console.log("Verify — Neon vs Turso after the final ETL\n")
  const models = modelNames()
  const turso = tursoClient()
  const neon = neonClient()
  await neon.connect()

  try {
    // 1. Per-model exact count parity (independent of the ETL's own tally)
    let mismatches = 0
    let totalT = 0
    let totalN = 0
    for (const model of models) {
      const [tr, nr] = await Promise.all([
        turso.execute(`SELECT count(*) n FROM "${model}"`),
        neon.query(`SELECT count(*)::int n FROM "${model}"`),
      ])
      const t = Number(tr.rows[0].n)
      const n = nr.rows[0].n as number
      totalT += t
      totalN += n
      if (t !== n) {
        mismatches++
        fail(`${model}: Turso ${t} vs Neon ${n}`)
      }
    }
    mismatches === 0
      ? ok(`all ${models.length} models match — ${totalN} rows`)
      : fail(`${mismatches} model(s) differ`)
    totalT === totalN ? ok(`grand total matches (${totalN})`) : fail(`grand total: Turso ${totalT} vs Neon ${totalN}`)

    // 2. default-workspace present
    const dw = await neon.query(`SELECT id FROM "Workspace" WHERE id='default-workspace'`)
    dw.rowCount === 1 ? ok("default-workspace present in Neon") : fail("default-workspace missing in Neon")

    // 3. no synthetic placeholder workspaces
    const synth = await neon.query(`SELECT count(*)::int n FROM "Workspace" WHERE status='orphaned_test_fixture'`)
    const s = synth.rows[0].n as number
    s === 0
      ? ok("no orphaned_test_fixture workspaces (residue purge worked)")
      : warn(`${s} orphaned_test_fixture workspace(s) in Neon — from ETL repairs; purge Turso residue and re-run for a clean prod`)

    // 4. Person deep-compare, 8 rows by id
    const sample = await turso.execute(`SELECT * FROM "Person" ORDER BY id LIMIT 8`)
    let diffs = 0
    for (const row of sample.rows) {
      const nr = await neon.query(`SELECT * FROM "Person" WHERE id=$1`, [row.id])
      if (nr.rowCount !== 1) {
        diffs++
        fail(`Person ${row.id} missing in Neon`)
        continue
      }
      const nrow = nr.rows[0]
      const norm = (v: unknown) => {
        if (v instanceof Date) return `t:${v.getTime()}`
        const s = String(v ?? "")
        // libSQL returns timestamps as UTC ISO text; compare as instants
        const d = /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(s) ? new Date(s) : null
        return d && !Number.isNaN(d.getTime()) ? `t:${d.getTime()}` : s
      }
      for (const key of ["first", "last", "workspaceId", "emails", "createdAt"]) {
        const a = norm(row[key])
        const b = norm(nrow[key])
        if (a !== b) {
          diffs++
          fail(`Person ${row.id}.${key}: ${a} vs ${b}`)
        }
      }
    }
    diffs === 0 ? ok("Person sample (8 rows) deep-compares clean") : fail(`${diffs} field diff(s) in Person sample`)

    // 5. FK integrity — Postgres enforces on insert, but confirm the deferred set committed clean
    const fk = await neon.query(`
      SELECT conrelid::regclass::text AS tbl, conname
      FROM pg_constraint WHERE contype='f' AND NOT convalidated`)
    fk.rowCount === 0 ? ok("all foreign keys validated") : fail(`${fk.rowCount} unvalidated FK(s): ${fk.rows.map((r) => r.conname).join(", ")}`)
  } finally {
    turso.close()
    await neon.end()
  }

  console.log(`\n${failures ? `${failures} problem(s) — do NOT flip. Roll back and diagnose.` : "Clean. Safe to flip DATABASE_URL and deploy."}`)
  process.exit(failures ? 1 : 0)
}

async function run() {
  loadEnv()
  const cmd = process.argv[2]
  if (cmd === "preflight") await preflight()
  else if (cmd === "verify") await verify()
  else {
    console.error("usage: tsx scripts/db/cutover.ts <preflight|verify>")
    process.exit(1)
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exit(1)
})
