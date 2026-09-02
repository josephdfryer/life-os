#!/usr/bin/env node

// Fail CI if a deploy landmine is reintroduced: a root vercel.json (overrides
// every project's settings and can drop crons), or vestigial per-app configs
// on apps whose Root Directory is the repo root (those files are never read).

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const problems = []

if (existsSync(join(root, "vercel.json"))) {
  problems.push(
    "Root vercel.json exists. The CLI sends it as deployment config and it overrides " +
    "the project's own settings (including crons). Delete it. See docs/DEPLOY_RUNBOOK.md.",
  )
}

const vestigial = ["apps/home/vercel.json", "apps/assistant/vercel.json"]
for (const relative of vestigial) {
  if (existsSync(join(root, relative))) {
    problems.push(
      `${relative} exists but that app's Vercel Root Directory is the repo root, so this file is never read. Delete it.`,
    )
  }
}

const cronFiles = {
  "apps/persons/vercel.json": [
    { path: "/api/cron/theory-refresh", schedule: "0 10 * * *" },
  ],
  "apps/events/vercel.json": [
    { path: "/api/cron/granola-sync", schedule: "0 14 * * *" },
    { path: "/api/cron/calendar-sync", schedule: "*/15 * * * *" },
  ],
}

for (const [relative, required] of Object.entries(cronFiles)) {
  const absolute = join(root, relative)
  if (!existsSync(absolute)) {
    problems.push(`${relative} is missing. It holds production crons.`)
    continue
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"))
  } catch (error) {
    problems.push(`${relative}: invalid JSON (${error instanceof Error ? error.message : error})`)
    continue
  }
  const crons = Array.isArray(parsed?.crons) ? parsed.crons : []
  for (const cron of required) {
    const found = crons.some(item => item.path === cron.path && item.schedule === cron.schedule)
    if (!found) {
      problems.push(`${relative} must define cron ${cron.path} (${cron.schedule}).`)
    }
  }
}

const appsDir = join(root, "apps")
const allowed = new Set(["persons", "events"])
for (const name of readdirSync(appsDir)) {
  if (allowed.has(name)) continue
  const extra = join(appsDir, name, "vercel.json")
  if (existsSync(extra)) {
    problems.push(`apps/${name}/vercel.json should not exist (no crons; Root Directory handles build settings).`)
  }
}

if (!existsSync(join(root, "scripts/vercel-ignored-build.mjs"))) {
  problems.push("scripts/vercel-ignored-build.mjs is missing. Git-connected projects skip production with it.")
}

if (problems.length) {
  console.error(`Deploy config problems (${problems.length}):\n${problems.map(item => `- ${item}`).join("\n")}`)
  process.exitCode = 1
} else {
  console.log("Deploy config: ok (no root vercel.json; persons/events crons present)")
}
