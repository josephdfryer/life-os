#!/usr/bin/env node

// Ignored Build Step for git-triggered Vercel deploys.
//
// Exit 0 = skip the build. Exit 1 = proceed.
// https://vercel.com/docs/project-configuration/git-settings#ignored-build-step
//
// Production (and pushes to master) always skip: GitHub Actions owns production
// via scripts/deploy.ts. Preview builds run only when this app is affected, so
// a persons-only PR does not consume the Hobby concurrent-build slot for
// places/home/etc. once those projects are git-connected.
//
// This file must stay runnable with stock Node — Vercel runs it before install.
// Keep the path rules in sync with scripts/lib/deploy-affected.ts.

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = existsSync(join(here, "package.json")) ? here : join(here, "..")

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

const APP_BY_PROJECT = {
  "life-os-home": "home",
  persons: "persons",
  "life-os-events": "events",
  "life-os-places": "places",
  "life-os-stuff": "stuff",
  "life-os-assistant": "assistant",
  "life-os-api": "api",
  "level-up": "level-up",
}

const APP_NAMES = Object.values(APP_BY_PROJECT)

function appsToDeploy(changedPaths) {
  const apps = new Set()
  for (const raw of changedPaths) {
    const path = String(raw).replace(/^\.\//, "")
    if (!path) continue
    if (ALL_APP_TRIGGERS.some(pattern => pattern.test(path))) return "all"
    const match = /^apps\/([^/]+)/.exec(path)
    if (!match) continue
    const app = match[1]
    if (app === "companion") continue
    if (APP_NAMES.includes(app)) apps.add(app)
  }
  return apps.size ? [...apps] : "none"
}

function changedPaths() {
  const before = process.env.VERCEL_GIT_PREVIOUS_SHA
  const after = process.env.VERCEL_GIT_COMMIT_SHA
  try {
    if (before && after && /^[0-9a-f]{7,}$/i.test(before) && !/^0+$/.test(before)) {
      return execFileSync("git", ["diff", "--name-only", before, after], { cwd: root, encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
    }
    return execFileSync("git", ["diff", "--name-only", "HEAD^", "HEAD"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
  } catch {
    return null
  }
}

const env = process.env.VERCEL_ENV ?? ""
const gitRef = process.env.VERCEL_GIT_COMMIT_REF ?? ""
const projectName = process.env.VERCEL_PROJECT_NAME ?? ""
const projectApp = APP_BY_PROJECT[projectName] ?? process.argv[2] ?? ""

if (env === "production" || gitRef === "master" || gitRef === "main") {
  console.log("Skipping git production deploy — GitHub Actions owns production (npm run deploy).")
  process.exit(0)
}

const paths = changedPaths()
if (!paths) {
  console.log("Could not determine changed files; proceeding with preview build.")
  process.exit(1)
}

const affected = appsToDeploy(paths)
if (affected === "all" || (Array.isArray(affected) && projectApp && affected.includes(projectApp))) {
  console.log(`Preview should build (${projectApp || projectName}): ${Array.isArray(affected) ? affected.join(", ") : "all apps"}.`)
  process.exit(1)
}

console.log(`Skipping preview for ${projectApp || projectName || "unknown project"} — not affected.`)
process.exit(0)
