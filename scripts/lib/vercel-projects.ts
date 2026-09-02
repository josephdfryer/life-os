// Source of truth for the LifeOS Vercel fleet.
//
// Deploy, env-sync, smoke checks, and the runbook all read this map. If a
// project is missing here, it will not be deployed or env-synced. The unused
// `db` project is intentionally absent.

export const VERCEL_TEAM_ID = "team_ftx6eq2s9NttYUc9WqQRwfa8"

export type ProjectShape = "repo-root" | "app-root"

export type CronDefinition = {
  path: string
  schedule: string
}

export type SmokeProbe = {
  url: string
  /** Human label in the smoke report. */
  label: string
}

export type VercelProject = {
  /** CLI / dashboard project name. */
  vercelName: string
  projectId: string
  /** Workspace package name, used as `turbo --filter`. */
  filter: string
  /** App directory under apps/. */
  app: string
  productionUrl: string
  shape: ProjectShape
  buildCommand: string
  outputDirectory: string
  crons: readonly CronDefinition[]
  smoke: readonly SmokeProbe[]
}

export const VERCEL_PROJECTS: readonly VercelProject[] = [
  {
    vercelName: "life-os-home",
    projectId: "prj_4TifUt9AIklx5ZmdMWss9f9Ktluf",
    filter: "home",
    app: "home",
    productionUrl: "https://home.lacollecteur.com",
    shape: "repo-root",
    buildCommand: "npx turbo run build --filter=home",
    outputDirectory: "apps/home/.next",
    crons: [],
    smoke: [
      { url: "https://lacollecteur.com/", label: "apex marketing" },
      { url: "https://home.lacollecteur.com/login", label: "home login" },
    ],
  },
  {
    vercelName: "persons",
    projectId: "prj_R3ONwJnoKVWEtq6IrugQOsHu9MmS",
    filter: "persons",
    app: "persons",
    productionUrl: "https://persons.lacollecteur.com",
    shape: "app-root",
    buildCommand: "cd ../.. && npx turbo run build --filter=persons",
    outputDirectory: ".next",
    crons: [{ path: "/api/cron/theory-refresh", schedule: "0 10 * * *" }],
    smoke: [{ url: "https://persons.lacollecteur.com/login", label: "persons login" }],
  },
  {
    vercelName: "life-os-events",
    projectId: "prj_2KwWKc85PvmuSJ92EhX0QsGb7Z9o",
    filter: "events",
    app: "events",
    productionUrl: "https://events.lacollecteur.com",
    shape: "app-root",
    buildCommand: "cd ../.. && npx turbo run build --filter=events",
    outputDirectory: ".next",
    crons: [
      { path: "/api/cron/granola-sync", schedule: "0 14 * * *" },
      { path: "/api/cron/calendar-sync", schedule: "*/15 * * * *" },
    ],
    smoke: [{ url: "https://events.lacollecteur.com/login", label: "events login" }],
  },
  {
    vercelName: "life-os-places",
    projectId: "prj_pVxCcqG3ob1Qe47FyAKE87hcW9qB",
    filter: "places",
    app: "places",
    productionUrl: "https://places.lacollecteur.com",
    shape: "app-root",
    buildCommand: "cd ../.. && npx turbo run build --filter=places",
    outputDirectory: ".next",
    crons: [],
    smoke: [{ url: "https://places.lacollecteur.com/login", label: "places login" }],
  },
  {
    vercelName: "life-os-stuff",
    projectId: "prj_rv0TqbNNsk6JwJx9SswDgdFyO59q",
    filter: "stuff",
    app: "stuff",
    productionUrl: "https://stuff.lacollecteur.com",
    shape: "repo-root",
    buildCommand: "npx turbo run build --filter=stuff",
    outputDirectory: "apps/stuff/.next",
    crons: [],
    smoke: [{ url: "https://stuff.lacollecteur.com/login", label: "stuff login" }],
  },
  {
    vercelName: "life-os-assistant",
    projectId: "prj_LmtslXEZtq3TgwtnvLgh1UEmHbI8",
    filter: "assistant",
    app: "assistant",
    productionUrl: "https://assistant.lacollecteur.com",
    shape: "repo-root",
    buildCommand: "turbo run build --filter=assistant",
    outputDirectory: "apps/assistant/.next",
    crons: [],
    smoke: [{ url: "https://assistant.lacollecteur.com/login", label: "assistant login" }],
  },
  {
    vercelName: "life-os-api",
    projectId: "prj_0tbb9ZGn84kjwZx67piwmGEYApp1",
    filter: "api",
    app: "api",
    productionUrl: "https://api.lacollecteur.com",
    shape: "repo-root",
    buildCommand: "npx turbo run build --filter=api",
    outputDirectory: "apps/api/.next",
    crons: [],
    smoke: [{ url: "https://api.lacollecteur.com/", label: "api health" }],
  },
  {
    vercelName: "level-up",
    projectId: "prj_K4xc5pnZDLcpI6EiRpm4JTCEqxFj",
    filter: "level-up",
    app: "level-up",
    productionUrl: "https://level-up.lacollecteur.com",
    shape: "repo-root",
    buildCommand: "npx turbo run build --filter=level-up",
    outputDirectory: "apps/level-up/.next",
    crons: [],
    smoke: [{ url: "https://level-up.lacollecteur.com/login", label: "level-up login" }],
  },
]

export const VERCEL_PROJECT_NAMES = VERCEL_PROJECTS.map(project => project.vercelName)

export function findProject(name: string): VercelProject | undefined {
  const needle = name.trim().toLowerCase()
  return VERCEL_PROJECTS.find(
    project =>
      project.vercelName.toLowerCase() === needle
      || project.filter.toLowerCase() === needle
      || project.app.toLowerCase() === needle,
  )
}

export function selectProjects(only?: string): VercelProject[] {
  if (!only) return [...VERCEL_PROJECTS]
  const project = findProject(only)
  if (!project) {
    const known = VERCEL_PROJECTS.map(item => `${item.filter} (${item.vercelName})`).join(", ")
    throw new Error(`Unknown project "${only}". Known: ${known}`)
  }
  return [project]
}

export function allSmokeProbes(projects: readonly VercelProject[]): SmokeProbe[] {
  return projects.flatMap(project => [...project.smoke])
}
