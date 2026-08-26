import type { CronDefinition } from "./vercel-projects"

export type HeadAlignment = "match" | "behind" | "ahead" | "diverged"

export type CiRun = {
  conclusion: string | null
  status: string
  url?: string
  event?: string
  name?: string
}

export type CiVerdict = {
  result: "pass" | "pending" | "fail" | "missing"
  run?: CiRun
  detail: string
}

export function dirtyTreeMessage(porcelain: string): string | null {
  const lines = porcelain.split("\n").map(line => line.trimEnd()).filter(Boolean)
  if (!lines.length) return null
  const preview = lines.slice(0, 12).join("\n")
  const extra = lines.length > 12 ? `\n  … ${lines.length - 12} more` : ""
  return (
    `Working tree is dirty (${lines.length} path(s)). Deploy uploads a git commit, not this tree.\n` +
    `Commit (or stash) first, or pass --allow-dirty to ship the working directory anyway.\n${preview}${extra}`
  )
}

export function headAlignment(
  head: string,
  originMaster: string,
  headIsAncestorOfOrigin: boolean,
  originIsAncestorOfHead: boolean,
): HeadAlignment {
  if (head === originMaster) return "match"
  if (headIsAncestorOfOrigin) return "behind"
  if (originIsAncestorOfHead) return "ahead"
  return "diverged"
}

export function alignmentMessage(alignment: HeadAlignment, head: string, originMaster: string): string | null {
  const short = (sha: string) => sha.slice(0, 7)
  if (alignment === "match") return null
  if (alignment === "behind") {
    return (
      `HEAD ${short(head)} is behind origin/master ${short(originMaster)}. ` +
      `Deploying would roll production back. git pull, or pass --allow-behind.`
    )
  }
  if (alignment === "ahead") {
    return (
      `HEAD ${short(head)} is not on origin/master. CI has not run on this commit. ` +
      `git push and wait for CI, or pass --allow-unpushed.`
    )
  }
  return (
    `HEAD ${short(head)} has diverged from origin/master ${short(originMaster)}. ` +
    `Move onto master before deploying.`
  )
}

export function ciVerdict(runs: CiRun[]): CiVerdict {
  const ciRuns = runs.filter(run => !run.name || /^CI$/i.test(run.name))
  const pool = ciRuns.length ? ciRuns : runs
  if (!pool.length) {
    return { result: "missing", detail: "No GitHub Actions run for this commit. Push to origin and wait, or pass --skip-ci." }
  }
  const failed = pool.find(run => run.conclusion === "failure" || run.conclusion === "cancelled" || run.conclusion === "timed_out")
  if (failed) {
    return { result: "fail", run: failed, detail: `CI failed (${failed.conclusion})${failed.url ? `: ${failed.url}` : ""}` }
  }
  const pending = pool.find(run => run.status !== "completed" || !run.conclusion)
  if (pending) {
    return { result: "pending", run: pending, detail: `CI is still ${pending.status}${pending.url ? `: ${pending.url}` : ""}` }
  }
  const passed = pool.find(run => run.conclusion === "success")
  if (passed) {
    return { result: "pass", run: passed, detail: "CI passed for this commit." }
  }
  return { result: "missing", detail: "No successful CI run for this commit." }
}

/** 2xx and 3xx are healthy. Auth apps redirect; marketing/login render 200. 4xx/5xx are not. */
export function smokeOk(status: number): boolean {
  return status >= 200 && status < 400
}

export function missingCrons(
  expected: readonly CronDefinition[],
  actual: readonly CronDefinition[],
): CronDefinition[] {
  return expected.filter(cron =>
    !actual.some(item => item.path === cron.path && item.schedule === cron.schedule),
  )
}

export type DeployOptions = {
  apply: boolean
  only?: string
  before?: string
  allowDirty: boolean
  allowUnpushed: boolean
  allowBehind: boolean
  skipCi: boolean
  skipMigrations: boolean
  skipSmoke: boolean
  list: boolean
  ci: boolean
  affected: boolean
}

export function parseDeployArgs(argv: string[]): DeployOptions {
  const options: DeployOptions = {
    apply: !argv.includes("--dry-run"),
    allowDirty: argv.includes("--allow-dirty"),
    allowUnpushed: argv.includes("--allow-unpushed"),
    allowBehind: argv.includes("--allow-behind"),
    skipCi: argv.includes("--skip-ci"),
    skipMigrations: argv.includes("--skip-migrations"),
    skipSmoke: argv.includes("--skip-smoke"),
    list: argv.includes("--list"),
    ci: argv.includes("--ci"),
    affected: argv.includes("--affected"),
  }
  for (let index = 0; index < argv.length; index++) {
    const next = argv[index + 1]
    if (argv[index] === "--only" && next) options.only = next
    if (argv[index] === "--before" && next) options.before = next
  }
  if (options.ci) options.skipCi = true
  return options
}

export const DEPLOY_HELP = `Deploy LifeOS apps to Vercel production.

Usage:
  npm run deploy                         # laptop path (clean origin/master + green CI)
  npm run deploy -- --dry-run
  npm run deploy -- --only persons
  npm run deploy -- --affected           # only apps touched by HEAD^..HEAD
  npm run deploy -- --list

Production CD is GitHub Actions on master (see .github/workflows/ci.yml).
This script is what that job runs, and the laptop fallback.

The script refuses a dirty tree, refuses a commit CI has not passed, and
refuses to ship if production Turso is missing columns the Prisma client
would select. It never writes a root vercel.json.

Flags:
  --dry-run            Run gates and print commands; do not upload
  --only <name>        One app (filter, directory, or Vercel project name)
  --affected           Deploy only apps touched since --before (default HEAD^)
  --before <sha>       With --affected, diff this SHA..HEAD
  --ci                 GitHub Actions mode: skip laptop gates, require VERCEL_TOKEN
  --allow-dirty        Upload the working directory, not git archive of HEAD
  --allow-unpushed     Allow HEAD ahead of origin/master
  --allow-behind       Allow HEAD behind origin/master (rollback)
  --skip-ci            Do not require a green GitHub Actions run
  --skip-migrations    Do not compare schema.prisma to production Turso
  --skip-smoke         Do not curl production URLs after deploy
  --list               Print the project map and exit
`
