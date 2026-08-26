import { VERCEL_PROJECTS } from "./vercel-projects"

export const VERCEL_APP_NAMES = VERCEL_PROJECTS.map(project => project.app)

const ALL_APP_TRIGGERS = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^turbo\.json$/,
  /^docker\//,
  /^packages\//,
  /^scripts\/deploy\.ts$/,
  /^scripts\/lib\/(vercel-projects|deploy-gates|deploy-affected|prod-schema|env)\.ts$/,
  /^scripts\/lib\/deploy-affected\.test\.ts$/,
  /^scripts\/vercel-ignored-build\.mjs$/,
  /^\.github\/workflows\/ci\.yml$/,
]

export type AffectedResult = { kind: "all" } | { kind: "none" } | { kind: "some"; apps: string[] }

export function appsToDeploy(changedPaths: readonly string[], appNames: readonly string[] = VERCEL_APP_NAMES): AffectedResult {
  const apps = new Set<string>()
  for (const raw of changedPaths) {
    const path = raw.replace(/^\.\//, "")
    if (!path || path.endsWith("/")) continue
    if (ALL_APP_TRIGGERS.some(pattern => pattern.test(path))) return { kind: "all" }
    const match = /^apps\/([^/]+)/.exec(path)
    if (!match) continue
    const app = match[1]
    if (app === "companion") continue
    if (appNames.includes(app)) apps.add(app)
  }
  if (apps.size) return { kind: "some", apps: [...apps].sort() }
  return { kind: "none" }
}

export function formatAffected(result: AffectedResult): string {
  if (result.kind === "all") return "all apps (shared package, lockfile, or deploy tooling changed)"
  if (result.kind === "none") return "none (docs/companion/unrelated paths only)"
  return result.apps.join(", ")
}

/** Git-triggered Vercel builds: skip production (Actions owns it). Previews build only when affected. */
export function skipGitTriggeredBuild(input: {
  vercelEnv?: string
  gitRef?: string
  changedPaths: readonly string[]
  projectApp: string
}): { skip: boolean; reason: string } {
  if (input.vercelEnv === "production" || input.gitRef === "master" || input.gitRef === "main") {
    return { skip: true, reason: "production deploys come from GitHub Actions, not git push" }
  }
  const affected = appsToDeploy(input.changedPaths)
  if (affected.kind === "all") {
    return { skip: false, reason: "shared code changed; preview should build" }
  }
  if (affected.kind === "some" && affected.apps.includes(input.projectApp)) {
    return { skip: false, reason: `${input.projectApp} changed; preview should build` }
  }
  return { skip: true, reason: `${input.projectApp} was not affected (${formatAffected(affected)})` }
}
