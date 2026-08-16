#!/usr/bin/env tsx

// Push one source-of-truth env file to every Life OS Vercel project.
//
// Why this exists: the account is on Hobby, and Vercel's team-level Shared
// Environment Variables are Pro-only. So the same TURSO_AUTH_TOKEN, AUTH_SECRET,
// NEXTAUTH_SECRET and GOOGLE_CLIENT_SECRET are copy-pasted into nine separate
// projects. Rotating any of them by hand is nine dashboard edits, and a
// half-finished rotation leaves some apps talking to the old credential and some
// to the new one — the kind of outage that looks like a code bug for an hour.
//
// The source of truth is a local file (default .env.shared at the repo root),
// NOT the Vercel API. Values marked Sensitive in Vercel cannot be read back —
// `vercel env pull` returns them blank — so there is no way to treat one project
// as canonical and fan out from it. The file is the canon; Vercel is a replica.
//
// .env.shared is covered by the root .gitignore (`.env*`) and must never be
// committed. This script never prints a value, only names.
//
// Usage:
//   npx tsx scripts/sync-vercel-env.ts                    # dry run, production
//   npx tsx scripts/sync-vercel-env.ts --apply            # actually write
//   npx tsx scripts/sync-vercel-env.ts --env preview --apply
//   npx tsx scripts/sync-vercel-env.ts --only life-os-places --apply
//   npx tsx scripts/sync-vercel-env.ts --var AUTH_SECRET --apply

import { execFileSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const TEAM = "team_ftx6eq2s9NttYUc9WqQRwfa8"

// Every project that should receive the shared set. Names, not IDs, so the
// output is readable; `vercel env add --project` accepts either.
const PROJECTS = [
  "persons",
  "life-os-home",
  "life-os-events",
  "life-os-places",
  "life-os-stuff",
  "life-os-assistant",
  "life-os-context",
  "life-os-api",
  "level-up",
]

// Variables whose correct value DIFFERS per project. Blanket-syncing these is
// not merely wasteful, it breaks things: an OAuth callback URL pinned to
// persons.lacollecteur.com will fail the redirect_uri check on every other
// domain. Everything not listed here is treated as genuinely shared — including
// the NEXT_PUBLIC_*_URL pointers, which name a *destination* app and so hold the
// same value no matter which app reads them.
const PER_PROJECT = new Set([
  "AUTH_URL",
  "NEXTAUTH_URL",
  "GOOGLE_CALENDAR_REDIRECT_URI",
  "GOOGLE_GMAIL_REDIRECT_URI",
])

// Vercel injects its own VERCEL_* / NEXT_PUBLIC_VERCEL_* values per deployment.
const isReserved = (name: string) => name.startsWith("VERCEL_") || name.startsWith("NEXT_PUBLIC_VERCEL_")

type Options = {
  apply: boolean
  environment: string
  only?: string
  variable?: string
  file: string
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: argv.includes("--apply"),
    environment: "production",
    file: join(root, ".env.shared"),
  }
  for (let index = 0; index < argv.length; index++) {
    const next = argv[index + 1]
    if (argv[index] === "--env" && next) options.environment = next
    if (argv[index] === "--only" && next) options.only = next
    if (argv[index] === "--var" && next) options.variable = next
    if (argv[index] === "--file" && next) options.file = resolve(next)
  }
  if (!["production", "preview", "development"].includes(options.environment)) {
    throw new Error(`--env must be production, preview, or development (got "${options.environment}")`)
  }
  return options
}

// Deliberately small: KEY=value, plus KEY="value" where the quoted form may
// carry escaped newlines. That covers the one awkward case we actually have,
// MAPKIT_PRIVATE_KEY, whose PEM body is multi-line.
function parseEnvFile(path: string) {
  const entries = new Map<string, string>()
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator === -1) continue
    const name = line.slice(0, separator).trim()
    const rawValue = line.slice(separator + 1).trim()
    if (!name) continue
    const quoted = rawValue.startsWith('"') && rawValue.endsWith('"') && rawValue.length > 1
    entries.set(name, quoted ? rawValue.slice(1, -1).replaceAll("\\n", "\n") : rawValue)
  }
  return entries
}

function push(name: string, value: string, project: string, environment: string) {
  // The value goes in on stdin rather than through --value, which would expose
  // the secret in the process list.
  execFileSync(
    "vercel",
    ["env", "add", name, environment, "--project", project, "--scope", TEAM, "--force", "--yes"],
    { input: value, stdio: ["pipe", "ignore", "pipe"] },
  )
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  if (!existsSync(options.file)) {
    console.error(`No source file at ${options.file}`)
    console.error("Create it with the shared values, one KEY=value per line. It is gitignored via `.env*`.")
    process.exit(1)
  }

  const parsed = parseEnvFile(options.file)
  const skipped: string[] = []
  const shared = new Map<string, string>()

  for (const [name, value] of parsed) {
    if (isReserved(name)) continue
    if (PER_PROJECT.has(name)) { skipped.push(name); continue }
    if (options.variable && name !== options.variable) continue
    shared.set(name, value)
  }

  const projects = options.only ? PROJECTS.filter(project => project === options.only) : PROJECTS
  if (options.only && !projects.length) {
    console.error(`Unknown project "${options.only}". Known: ${PROJECTS.join(", ")}`)
    process.exit(1)
  }
  if (!shared.size) {
    console.error("Nothing to sync.")
    process.exit(1)
  }

  console.log(`${options.apply ? "Syncing" : "DRY RUN —"} ${shared.size} variable(s) → ${projects.length} project(s) [${options.environment}]`)
  console.log(`Source: ${options.file}\n`)
  console.log(`Variables: ${[...shared.keys()].sort().join(", ")}\n`)
  if (skipped.length) {
    console.log(`Held back as per-project (would break OAuth callbacks if shared): ${skipped.sort().join(", ")}\n`)
  }

  if (!options.apply) {
    console.log("Re-run with --apply to write these to Vercel.")
    return
  }

  let written = 0
  const failures: string[] = []
  for (const project of projects) {
    for (const [name, value] of shared) {
      try {
        push(name, value, project, options.environment)
        written++
        console.log(`  ✓ ${project} ${name}`)
      } catch (error) {
        const detail = error instanceof Error ? error.message.split("\n")[0] : String(error)
        failures.push(`${project} ${name}: ${detail}`)
        console.log(`  ✗ ${project} ${name}`)
      }
    }
  }

  console.log(`\n${written} written, ${failures.length} failed.`)
  if (failures.length) {
    // A partial sync is the exact failure mode this script exists to prevent,
    // so make it loud and exit non-zero rather than reporting a tidy summary.
    console.error("\nFailures:")
    for (const failure of failures) console.error(`  ${failure}`)
    console.error("\nSome projects now hold different values than others. Re-run to converge.")
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
