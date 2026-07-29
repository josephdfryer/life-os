#!/usr/bin/env tsx

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
const PLISTS_DIR = path.join(import.meta.dirname, "plists")
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), "Library/LaunchAgents")

const PLIST_NAMES = [
  "com.lifeos.capture",
  "com.lifeos.krisp",
  "com.lifeos.synthesis",
  "com.lifeos.brief",
  "com.lifeos.backup",
  "com.lifeos.gmailsync",
  "com.lifeos.locationsync",
  "com.lifeos.voicejournal",
  "com.lifeos.photossync",
  "com.lifeos.documentsync",
  "com.lifeos.notefacts",
  "com.lifeos.whatsappsync",
]

function main() {
  const args = process.argv.slice(2)
  const uninstall = args.includes("--uninstall")
  const onlyIndex = args.indexOf("--only")
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null
  if (onlyIndex >= 0 && (!only || !PLIST_NAMES.includes(only))) {
    throw new Error(`--only must name one configured agent: ${PLIST_NAMES.join(", ")}`)
  }
  const selectedNames = only ? [only] : PLIST_NAMES

  fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true })
  fs.mkdirSync(path.join(REPO_ROOT, "logs"), { recursive: true })

  for (const name of selectedNames) {
    const destPath = path.join(LAUNCH_AGENTS_DIR, `${name}.plist`)

    if (uninstall) {
      unloadPlist(destPath, name)
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
      console.log(`[scheduler] Uninstalled ${name}`)
      continue
    }

    const sourcePath = path.join(PLISTS_DIR, `${name}.plist`)
    let content = fs.readFileSync(sourcePath, "utf8")
    content = content.replaceAll("LIFE_OS_ROOT", REPO_ROOT)

    fs.writeFileSync(destPath, content)

    // Unload first in case it was already loaded
    try {
      execSync(`launchctl unload "${destPath}" 2>/dev/null`, { stdio: "ignore" })
    } catch {
      // ignore — not loaded yet
    }

    execSync(`launchctl load "${destPath}"`)
    console.log(`[scheduler] Installed and loaded ${name}`)
  }

  if (!uninstall) {
    console.log(`\n[scheduler] ${only ? `${only} installed.` : "All agents installed."}`)
    console.log(`  Logs: ${REPO_ROOT}/logs/`)
    console.log(`  Run manually: npm run capture:all`)
    console.log(`  Check status: launchctl list | grep lifeos`)
  }
}

function unloadPlist(destPath: string, name: string) {
  if (!fs.existsSync(destPath)) return
  try {
    execSync(`launchctl unload "${destPath}"`)
    console.log(`[scheduler] Unloaded ${name}`)
  } catch {
    // already unloaded
  }
}

main()
