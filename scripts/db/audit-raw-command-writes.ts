#!/usr/bin/env tsx
// Turn "17 scripts write primitives via raw Prisma" (the plan's rough guess,
// ~/.claude's project_central_nervous_system.md, Track A7) into an actual,
// re-checkable worklist instead of a one-time audit that rots.
//
// Not every raw write is a gap: a shared command only exists for a few
// models (StagedInteraction/Interaction's day-bucket-append via
// @life-os/domain), and several scripts write genuinely domain-specific
// shapes a generic command was never meant to cover (scripts/era/*'s
// financial Interactions carry amount/category/merchant/account/actor
// fields appendDailySourceInteraction knows nothing about — forcing that
// fit would be the wrong migration, not a deferred one). This script
// doesn't guess at that judgment call; it surfaces exactly two signals per
// finding — does a shared command exist for this model, and does this file
// already import it — and leaves the "should this actually migrate"
// decision to whoever reads the list, the same way audit-unbounded-
// queries.ts ranks without deciding.
//
//   npx tsx scripts/db/audit-raw-command-writes.ts            # every finding
//   npx tsx scripts/db/audit-raw-command-writes.ts --gaps     # only files with a shared command they don't import
//   npx tsx scripts/db/audit-raw-command-writes.ts --md       # markdown table
//
// Read-only.

import fs from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
const SCRIPTS_DIR = path.join(REPO_ROOT, "scripts")
const GAPS_ONLY = process.argv.includes("--gaps")
const AS_MARKDOWN = process.argv.includes("--md")

/**
 * Models with a real shared-command alternative today, and where it lives.
 * Extend this as packages/domain grows more commands (A4/A7 follow-ups) —
 * everything else (Person, Event, Plan, Note, State, Group, Item, ...) has
 * no package-level command yet, so a raw write to those isn't a migration
 * gap, it's the only option that currently exists.
 */
const COMMANDS: Record<string, { command: string; module: string }> = {
  stagedInteraction: { command: "appendDailySourceInteraction / acceptStagedInteraction", module: "@life-os/domain" },
  interaction: { command: "appendDailySourceInteraction / acceptStagedInteraction", module: "@life-os/domain" },
  reviewItem: { command: "createReviewItem / syncReviewItemStatus", module: "@life-os/domain" },
  rule: { command: "runRulesForTarget / createRule", module: "@life-os/automation" },
  ruleRun: { command: "runRulesForTarget", module: "@life-os/automation" },
}

type Finding = {
  file: string
  line: number
  model: string
  op: string
  hasCommand: boolean
  alreadyImports: boolean
  snippet: string
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "lib") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full)
  }
  return out
}

const WRITE_RE = /\bdb\.([a-zA-Z]+)\.(create|update|upsert|createMany|updateMany)\s*\(/g

const findings: Finding[] = []

for (const file of walk(SCRIPTS_DIR)) {
  const source = fs.readFileSync(file, "utf8")
  const relFile = path.relative(REPO_ROOT, file)

  for (const match of source.matchAll(WRITE_RE)) {
    const model = match[1]
    const spec = COMMANDS[model]
    if (!spec) continue // no shared command exists for this model — not a gap, not tracked

    const line = source.slice(0, match.index).split("\n").length
    const alreadyImports = new RegExp(`from ["']${spec.module.replace("/", "\\/")}["']`).test(source)
      && new RegExp(spec.command.split(" / ")[0]).test(source)

    findings.push({
      file: relFile,
      line,
      model,
      op: match[2],
      hasCommand: true,
      alreadyImports,
      snippet: source.split("\n")[line - 1]?.trim().slice(0, 100) ?? "",
    })
  }
}

const filtered = GAPS_ONLY ? findings.filter(f => !f.alreadyImports) : findings

if (filtered.length === 0) {
  console.log(GAPS_ONLY ? "No gaps — every raw write to a command-backed model is in a file that already imports the shared command." : "No raw writes found to any command-backed model.")
  process.exit(0)
}

if (AS_MARKDOWN) {
  console.log("| File | Line | Model | Op | Shared command | Already imports? |")
  console.log("|---|---|---|---|---|---|")
  for (const f of filtered) {
    const spec = COMMANDS[f.model]
    console.log(`| ${f.file} | ${f.line} | ${f.model} | ${f.op} | ${spec.command} | ${f.alreadyImports ? "yes" : "**no**"} |`)
  }
} else {
  for (const f of filtered) {
    const spec = COMMANDS[f.model]
    const flag = f.alreadyImports ? "  " : "⚠ "
    console.log(`${flag}${f.file}:${f.line}  ${f.model}.${f.op}()  →  ${spec.command} (${spec.module})  [imports it: ${f.alreadyImports}]`)
    console.log(`    ${f.snippet}`)
  }
}

console.log(`\n${filtered.length} finding(s)${GAPS_ONLY ? " without the shared command imported" : ""} across ${new Set(filtered.map(f => f.file)).size} file(s).`)
