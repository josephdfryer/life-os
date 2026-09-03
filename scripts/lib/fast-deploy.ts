export type FastDeployRejection = {
  path: string
  reason: string
}

export type FastDeployAssessment = {
  ok: boolean
  deployPaths: string[]
  ignoredPaths: string[]
  rejections: FastDeployRejection[]
}

const NON_SHIPPING_PATHS = [
  /^docs\//,
  /(^|\/)README\.md$/i,
  /(^|\/)HANDOFF\.md$/i,
  /^AGENTS\.md$/i,
  /^CONTRIBUTING\.md$/i,
]

const HIGH_RISK_APP_PATHS: { pattern: RegExp; reason: string }[] = [
  { pattern: /(^|\/)package\.json$/, reason: "dependency or build configuration changed" },
  { pattern: /(^|\/)vercel\.(json|ts)$/, reason: "Vercel configuration changed" },
  { pattern: /(^|\/)next\.config\.[^/]+$/, reason: "Next.js runtime configuration changed" },
  { pattern: /(^|\/)\.env(?:\.|$)/, reason: "environment configuration changed" },
  { pattern: /(^|\/)prisma\//, reason: "database schema or migration code changed" },
  { pattern: /(^|\/)app\/api\//, reason: "an API route changed" },
  { pattern: /(^|\/)server\//, reason: "server/domain behavior changed" },
  { pattern: /(^|\/)scripts?\//, reason: "an operational script changed" },
  { pattern: /(^|\/)(middleware|proxy)\.[^/]+$/, reason: "request/auth middleware changed" },
  { pattern: /(^|\/)(route|actions?|mutations?|commands?)\.[^/]+$/, reason: "a server handler or mutation changed" },
  { pattern: /(^|\/)(auth|access|permissions?|cron|collectors?|imports?|sync)(\/|[._-])/, reason: "security or ingestion behavior changed" },
]

function isNonShippingPath(path: string): boolean {
  return NON_SHIPPING_PATHS.some(pattern => pattern.test(path))
}

/**
 * Fast deploy is intentionally an app-local UI/read-path lane. It is not a
 * substitute for CI when a change can mutate data, alter auth, or affect more
 * than one deployed project.
 */
export function assessFastDeploy(changedPaths: readonly string[], targetApp: string): FastDeployAssessment {
  const deployPaths: string[] = []
  const ignoredPaths: string[] = []
  const rejections: FastDeployRejection[] = []
  const appPrefix = `apps/${targetApp}/`

  if (targetApp === "api") {
    return {
      ok: false,
      deployPaths,
      ignoredPaths,
      rejections: [{ path: appPrefix, reason: "the API project always requires the full CI lane" }],
    }
  }

  for (const rawPath of changedPaths) {
    const path = rawPath.replace(/^\.\//, "")
    if (!path) continue
    if (isNonShippingPath(path)) {
      ignoredPaths.push(path)
      continue
    }
    if (!path.startsWith(appPrefix)) {
      rejections.push({ path, reason: `change is outside apps/${targetApp}` })
      continue
    }
    const relativePath = path.slice(appPrefix.length)
    const risk = HIGH_RISK_APP_PATHS.find(item => item.pattern.test(relativePath))
    if (risk) {
      rejections.push({ path, reason: risk.reason })
      continue
    }
    deployPaths.push(path)
  }

  if (!deployPaths.length && !rejections.length) {
    rejections.push({ path: appPrefix, reason: "no deployable app change exists ahead of origin/master" })
  }

  return {
    ok: rejections.length === 0 && deployPaths.length > 0,
    deployPaths,
    ignoredPaths,
    rejections,
  }
}

export function formatFastDeployRejections(rejections: readonly FastDeployRejection[]): string {
  return rejections.map(item => `  - ${item.path}: ${item.reason}`).join("\n")
}
