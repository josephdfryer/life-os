#!/usr/bin/env tsx
// Turn "160 unbounded findMany calls" into a worklist you can actually act on.
//
// The performance budget counts findMany calls with no `take` or `cursor`. A
// raw count is not actionable: an unbounded read of a 4-row lookup table is
// fine forever, and an unbounded read of Interaction is a page that gets slower
// every month. Risk is roughly:
//
//     how many rows the table holds  ×  how often the path runs
//
// So this pairs every call site with the live row count of the model it reads,
// and with where it sits — a request path, a background job, or a one-shot CLI.
//
//   npx tsx scripts/db/audit-unbounded-queries.ts            # worst first
//   npx tsx scripts/db/audit-unbounded-queries.ts --serving  # request paths only
//   npx tsx scripts/db/audit-unbounded-queries.ts --md       # markdown table
//
// Read-only.

import fs from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
for (const candidate of [path.join(REPO_ROOT, ".env"), path.join(REPO_ROOT, "apps/persons/.env")]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "coverage", "generated", "archive"])
const SERVING_ONLY = process.argv.includes("--serving")
const AS_MARKDOWN = process.argv.includes("--md")

/** Where a call site sits decides how much an unbounded read costs. */
type Context = "request" | "background" | "script" | "test"

type Finding = {
  file: string
  line: number
  model: string
  context: Context
  rows: number | null
  /** A where clause that can only return a few rows, despite no `take`. */
  bounded: boolean
  snippet: string
}

/**
 * The budget flags any findMany without take/cursor, but that is a proxy. A
 * query filtered by `id: { in: ids }` or a unique-ish field returns a handful
 * of rows however large the table gets. Those are not the problem; a scan
 * filtered only by workspaceId is. This separates the two so the worklist is
 * the queries a human actually needs to read.
 */
function looksBounded(call: string): boolean {
  // Matches "id", and also "personId", "workspaceId"-style foreign keys.
  if (/[A-Za-z]*\b[Ii]d\s*:\s*\{\s*in\s*:/.test(call)) return true   // explicit id set
  if (/[A-Za-z]*[Ii]d\s*:\s*\{\s*in\s*:/.test(call)) return true
  if (/\bwhere\s*:\s*\{[^}]*\b(email|slug|key|googlePlaceId|sourceId)\s*:/.test(call)) return true
  return false
}

function classify(relativePath: string): Context {
  if (/\.test\.tsx?$/.test(relativePath) || relativePath.includes("/tests/")) return "test"
  if (relativePath.startsWith("scripts/")) return "script"
  // A route handler or a server component runs per request; a cron target or a
  // sync module runs on a schedule and can afford a full scan.
  if (/\/app\/api\//.test(relativePath)) return /\/(cron|sync|webhook)\//.test(relativePath) ? "background" : "request"
  if (/\/app\/.*\/(page|layout)\.tsx$/.test(relativePath)) return "request"
  if (/\/server\/domain\//.test(relativePath)) return "request"
  // An app's lib/ is imported by its routes and components, so it runs per
  // request too; only standalone sync/cron modules are genuinely background.
  if (/^apps\/.*\/lib\//.test(relativePath)) return /sync|cron|scheduler/.test(relativePath) ? "background" : "request"
  return "background"
}

function sourceFiles(directory: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(directory, entry)
    if (fs.statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if ([".ts", ".tsx"].includes(path.extname(full))) out.push(full)
  }
  return out
}

/** `db.interaction.findMany(` -> "interaction" */
function modelBefore(source: string, index: number): string {
  // `index` points at ".findMany", so the text before it ends with the model.
  const head = source.slice(Math.max(0, index - 80), index)
  const match = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(head)
  return match ? match[1] : "unknown"
}

async function main() {
  const { db } = await import("@life-os/db")

  const findings: Finding[] = []
  for (const area of ["apps", "packages", "scripts"]) {
    for (const file of sourceFiles(path.join(REPO_ROOT, area))) {
      const source = fs.readFileSync(file, "utf8")
      const relativePath = path.relative(REPO_ROOT, file)
      for (const match of source.matchAll(/\.findMany\s*\(/g)) {
        // Same brace walk the budget check uses, so the two agree on what counts.
        let depth = 1
        let cursor = match.index + match[0].length
        while (cursor < source.length && depth > 0) {
          if (source[cursor] === "(") depth += 1
          if (source[cursor] === ")") depth -= 1
          cursor += 1
        }
        const call = source.slice(match.index, cursor)
        if (/\b(take|cursor)\s*:/.test(call)) continue

        findings.push({
          file: relativePath,
          line: source.slice(0, match.index).split("\n").length,
          model: modelBefore(source, match.index),
          context: classify(relativePath),
          rows: null,
          bounded: looksBounded(call),
          snippet: call.slice(0, 90).replace(/\s+/g, " "),
        })
      }
    }
  }

  // Live row counts make the risk concrete instead of theoretical.
  const models = [...new Set(findings.map(f => f.model))]
  const rowsByModel = new Map<string, number | null>()
  for (const model of models) {
    const delegate = (db as unknown as Record<string, { count?: () => Promise<number> }>)[model]
    try {
      rowsByModel.set(model, delegate?.count ? await delegate.count() : null)
    } catch {
      rowsByModel.set(model, null)
    }
  }
  for (const finding of findings) finding.rows = rowsByModel.get(finding.model) ?? null

  const weight: Record<Context, number> = { request: 1000, background: 10, script: 1, test: 0 }
  const scored = findings
    .filter(f => (SERVING_ONLY ? f.context === "request" : true))
    // A bounded where clause drops the score by two orders of magnitude — still
    // visible, but below everything that genuinely scans a growing table.
    .map(f => ({ ...f, score: (f.rows ?? 0) * weight[f.context] / (f.bounded ? 100 : 1) }))
    .sort((a, b) => b.score - a.score)

  if (AS_MARKDOWN) {
    console.log(`| Rows | Model | Where | Location |`)
    console.log(`|---:|---|---|---|`)
    for (const f of scored.slice(0, 40)) {
      console.log(`| ${f.rows ?? "?"} | ${f.model} | ${f.context} | \`${f.file}:${f.line}\` |`)
    }
  } else {
    const byContext = (context: Context) => findings.filter(f => f.context === context).length
    console.log(`Unbounded findMany calls: ${findings.length}`)
    console.log(`  request paths   ${byContext("request")}   <- these are the ones that matter`)
    console.log(`  background jobs ${byContext("background")}`)
    console.log(`  one-shot CLI    ${byContext("script")}`)
    console.log(`  tests           ${byContext("test")}`)
    console.log(`  of those, bounded by a selective where: ${findings.filter(f => f.bounded).length}\n`)
    console.log(`Worst first (rows in the table x how often the path runs):\n`)
    for (const f of scored.slice(0, 25)) {
      const rows = f.rows === null ? "    ?" : String(f.rows).padStart(5)
      console.log(`  ${rows} rows  ${f.context.padEnd(10)} ${f.bounded ? "[bounded] " : "          "}${f.file}:${f.line}`)
      console.log(`               ${f.snippet}`)
    }
    const unknown = findings.filter(f => f.rows === null).length
    if (unknown > 0) console.log(`\n  (${unknown} call sites read a model this script could not resolve a count for)`)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
