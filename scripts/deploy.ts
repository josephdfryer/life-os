#!/usr/bin/env tsx

// Production deploy for the eight LifeOS Vercel projects.
//
// GitHub Actions on master is the CD path (`--ci --affected` after lint+check).
// The laptop command is the hotfix / bootstrap fallback.
//
// See docs/DEPLOY_RUNBOOK.md.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  alignmentMessage,
  ciVerdict,
  DEPLOY_HELP,
  dirtyTreeMessage,
  headAlignment,
  missingCrons,
  parseDeployArgs,
  smokeOk,
  type CiRun,
  type DeployOptions,
} from "./lib/deploy-gates"
import { appsToDeploy, formatAffected } from "./lib/deploy-affected"
import { loadDotEnv } from "./lib/env"
import { applyProdMigrations, assertProdSchema } from "./lib/prod-schema"
import {
  allSmokeProbes,
  findProject,
  selectProjects,
  VERCEL_PROJECTS,
  VERCEL_TEAM_ID,
  type CronDefinition,
  type VercelProject,
} from "./lib/vercel-projects"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function git(args: string[], allowFail = false): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return (result.stdout || "").trim()
}

function run(command: string, args: string[], cwd = root, inherit = true) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    const detail = inherit ? `exit ${result.status}` : (result.stderr || result.stdout || `exit ${result.status}`).trim()
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`)
  }
  return result
}

function captured(command: string, args: string[], cwd = root): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return (result.stdout || "").trim()
}

function listProjects() {
  console.log("LifeOS Vercel projects\n")
  for (const project of VERCEL_PROJECTS) {
    const crons = project.crons.length
      ? project.crons.map(cron => `${cron.path} @ ${cron.schedule}`).join(", ")
      : "none"
    console.log(
      `${project.filter.padEnd(10)} ${project.vercelName.padEnd(20)} ${project.shape.padEnd(10)} ${project.productionUrl}`,
    )
    console.log(`           build ${project.buildCommand}`)
    console.log(`           crons ${crons}`)
  }
}

function requireCleanTree(options: DeployOptions) {
  const porcelain = git(["status", "--porcelain"])
  const dirty = dirtyTreeMessage(porcelain)
  if (!dirty) return
  if (options.allowDirty) {
    console.warn(`\nWARNING: ${dirty}\nUploading the working directory, not HEAD.\n`)
    return
  }
  throw new Error(dirty)
}

function requireHeadAlignment(options: DeployOptions): string {
  const head = git(["rev-parse", "HEAD"])
  if (options.ci) return head
  spawnSync("git", ["fetch", "origin", "master"], { cwd: root, encoding: "utf8" })
  const originMaster = git(["rev-parse", "origin/master"], true)
  if (!originMaster) {
    console.warn("Could not resolve origin/master; skipping alignment check.")
    return head
  }
  const isAncestor = (a: string, b: string) =>
    spawnSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: root }).status === 0
  const alignment = headAlignment(head, originMaster, isAncestor(head, originMaster), isAncestor(originMaster, head))
  const message = alignmentMessage(alignment, head, originMaster)
  if (!message) return head
  if (alignment === "ahead" && options.allowUnpushed) {
    console.warn(`\nWARNING: ${message}\n`)
    return head
  }
  if (alignment === "behind" && options.allowBehind) {
    console.warn(`\nWARNING: ${message}\n`)
    return head
  }
  throw new Error(message)
}

function requireCi(sha: string, options: DeployOptions) {
  if (options.ci) {
    console.log("CI mode: lint+check already ran in this workflow.")
    return
  }
  if (options.skipCi || options.allowDirty) {
    console.log(options.allowDirty
      ? "Skipping CI gate: dirty working tree is not the commit CI tested."
      : "Skipping CI gate (--skip-ci).")
    if (!options.apply) return
    console.log("Running local lint as a consolation prize.")
    run("npm", ["run", "lint"])
    return
  }
  let raw: string
  try {
    raw = captured("gh", [
      "run", "list",
      "--commit", sha,
      "--workflow", "CI",
      "--json", "conclusion,status,url,event,name",
      "--limit", "10",
    ])
  } catch (error) {
    throw new Error(
      `Could not read GitHub Actions for ${sha.slice(0, 7)} (${error instanceof Error ? error.message : error}). ` +
      `Install/auth gh, or pass --skip-ci.`,
    )
  }
  const runs = JSON.parse(raw) as CiRun[]
  const verdict = ciVerdict(runs)
  if (verdict.result === "pass") {
    console.log(verdict.detail)
    return
  }
  throw new Error(verdict.detail)
}

function changedPaths(before?: string): string[] {
  const head = git(["rev-parse", "HEAD"])
  if (before && !/^0+$/.test(before)) {
    return git(["diff", "--name-only", before, head]).split("\n").filter(Boolean)
  }
  const againstParent = git(["diff", "--name-only", "HEAD^", "HEAD"], true)
  if (againstParent) return againstParent.split("\n").filter(Boolean)
  return git(["ls-files"]).split("\n").filter(Boolean)
}

function projectsFor(options: DeployOptions): VercelProject[] {
  if (options.only) return selectProjects(options.only)
  if (!options.affected) return selectProjects()
  const paths = changedPaths(options.before)
  const result = appsToDeploy(paths)
  console.log(`Changed ${paths.length} path(s). Deploy ${formatAffected(result)}.`)
  if (result.kind === "none") return []
  if (result.kind === "all") return selectProjects()
  return result.apps.map(app => {
    const project = findProject(app)
    if (!project) throw new Error(`Affected app "${app}" is not a Vercel project.`)
    return project
  })
}

function requireCiToken(options: DeployOptions) {
  if (!options.ci || !options.apply) return
  if (!process.env.VERCEL_TOKEN) {
    throw new Error(
      "CI deploy requires VERCEL_TOKEN. Add it as a GitHub Actions secret " +
      "(Vercel account token with deploy access to the team). See docs/DEPLOY_RUNBOOK.md.",
    )
  }
}

function requireNoRootVercelJson() {
  if (existsSync(join(root, "vercel.json"))) {
    throw new Error("Root vercel.json exists. Delete it before deploying. See docs/DEPLOY_RUNBOOK.md.")
  }
}

function archiveHead(sha: string): string {
  const dir = mkdtempSync(join(tmpdir(), "life-os-deploy-"))
  const tar = join(dir, `${sha.slice(0, 7)}.tar`)
  const extract = join(dir, "src")
  mkdirSync(extract)
  run("git", ["archive", "--format=tar", "-o", tar, "HEAD"], root, false)
  run("tar", ["-xf", tar, "-C", extract], root, false)
  return extract
}

function writeLink(extract: string, project: VercelProject) {
  mkdirSync(join(extract, ".vercel"), { recursive: true })
  writeFileSync(
    join(extract, ".vercel", "project.json"),
    `${JSON.stringify({ orgId: VERCEL_TEAM_ID, projectId: project.projectId }, null, 2)}\n`,
  )
}

function deployProject(project: VercelProject, cwd: string, apply: boolean) {
  const args = [
    "deploy",
    "--prod",
    "--yes",
    "--scope", VERCEL_TEAM_ID,
    "--project", project.vercelName,
  ]
  console.log(`\n→ ${project.filter} (${project.vercelName})\n  vercel ${args.join(" ")}\n  cwd ${cwd}`)
  if (!apply) {
    console.log("  skipped (--dry-run)")
    return
  }
  run("vercel", args, cwd, true)
}

async function smoke(projects: VercelProject[]) {
  const probes = allSmokeProbes(projects)
  const failures: string[] = []
  console.log(`\nSmoke (${probes.length} URL${probes.length === 1 ? "" : "s"})`)
  for (const probe of probes) {
    try {
      const response = await fetch(probe.url, { redirect: "manual", signal: AbortSignal.timeout(20_000) })
      const ok = smokeOk(response.status)
      console.log(`  ${ok ? "✓" : "✗"} ${probe.label}  ${response.status}  ${probe.url}`)
      if (!ok) failures.push(`${probe.label}: HTTP ${response.status} ${probe.url}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.log(`  ✗ ${probe.label}  ${detail}`)
      failures.push(`${probe.label}: ${detail}`)
    }
  }
  if (failures.length) {
    throw new Error(`Smoke failed:\n${failures.map(item => `  ${item}`).join("\n")}`)
  }
}

function readProjectCrons(project: VercelProject): CronDefinition[] {
  const raw = captured("vercel", [
    "api",
    `/v9/projects/${project.vercelName}?teamId=${VERCEL_TEAM_ID}`,
    "--scope",
    VERCEL_TEAM_ID,
  ])
  const parsed = JSON.parse(raw) as {
    crons?: { disabledAt?: number | null; definitions?: { path: string; schedule: string }[] }
  }
  if (parsed.crons?.disabledAt) {
    throw new Error(`${project.vercelName} crons are disabled (disabledAt=${parsed.crons.disabledAt}).`)
  }
  return (parsed.crons?.definitions ?? []).map(item => ({ path: item.path, schedule: item.schedule }))
}

function verifyCrons(projects: VercelProject[]) {
  const withCrons = projects.filter(project => project.crons.length)
  if (!withCrons.length) return
  console.log("\nCrons")
  for (const project of withCrons) {
    const actual = readProjectCrons(project)
    const missing = missingCrons(project.crons, actual)
    if (missing.length) {
      throw new Error(
        `${project.vercelName} is missing cron(s): ` +
        missing.map(item => `${item.path} (${item.schedule})`).join(", ") +
        `. A root vercel.json override is the usual cause.`,
      )
    }
    for (const cron of project.crons) {
      console.log(`  ✓ ${project.filter}  ${cron.path}  ${cron.schedule}`)
    }
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(DEPLOY_HELP)
    return
  }
  const options = parseDeployArgs(argv)
  if (options.list) {
    listProjects()
    return
  }

  loadDotEnv(root)
  requireCiToken(options)
  requireNoRootVercelJson()
  requireCleanTree(options)
  const sha = requireHeadAlignment(options)
  requireCi(sha, options)

  const projects = projectsFor(options)
  if (!projects.length) {
    console.log("Nothing to deploy.")
    return
  }
  console.log(`Deploy ${options.apply ? "production" : "dry-run"}  HEAD ${sha.slice(0, 7)}  ${projects.map(p => p.filter).join(", ")}`)

  if (!options.skipMigrations) {
    console.log(await applyProdMigrations(root))
    console.log(await assertProdSchema(root))
  } else {
    console.log("Skipping production schema check (--skip-migrations).")
  }

  let uploadRoot = root
  let cleanup: string | undefined
  if (!options.allowDirty) {
    uploadRoot = archiveHead(sha)
    cleanup = dirname(uploadRoot)
    console.log(`Upload source: git archive ${sha.slice(0, 7)} → ${uploadRoot}`)
  } else {
    console.log("Upload source: working directory (because --allow-dirty).")
  }

  try {
    for (const project of projects) {
      if (!options.allowDirty) writeLink(uploadRoot, project)
      deployProject(project, uploadRoot, options.apply)
    }
    if (!options.skipSmoke) await smoke(projects)
    else console.log("Skipping smoke (--skip-smoke).")
    verifyCrons(projects)
  } finally {
    if (cleanup) rmSync(cleanup, { recursive: true, force: true })
  }

  console.log(options.apply ? "\nDeploy finished." : "\nDry run finished. Re-run without --dry-run to upload.")
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
