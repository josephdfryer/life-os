#!/usr/bin/env tsx

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import type { PrismaClient } from "@life-os/db"

const require = createRequire(import.meta.url)
const dotenv = require("dotenv") as { config(options: { path: string; quiet?: boolean }): void }
loadEnv()

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
const BRIEFS_DIR = path.join(REPO_ROOT, "briefs")
const WORKSPACE_ID = process.env.BRIEF_WORKSPACE_ID ?? "default-workspace"

let db: PrismaClient

// Annotation patterns in the brief:
//   - [x] action item text             → mark action item complete (find by text match)
//   - [follow-up: Name] plan text      → create a Plan linked to resolved person
//   - [note: Name] some note           → append to Person.notes

async function main() {
  db = (await import("@life-os/db")).db
  const { completeActionItemByText, createPlan, appendPersonNote, findPersonByName } = await import("@life-os/domain")
  const briefPath = parseBriefPath(process.argv[2])

  if (!fs.existsSync(briefPath)) {
    throw new Error(`Brief not found: ${briefPath}`)
  }

  const content = fs.readFileSync(briefPath, "utf8")
  const lines = content.split("\n")

  let completed = 0
  let plansCreated = 0
  let notesAdded = 0

  for (const line of lines) {
    const trimmed = line.trim()

    // [x] action item → mark interaction action item complete
    if (/^\[x\]\s+/i.test(trimmed)) {
      const description = trimmed.replace(/^\[x\]\s+/i, "").replace(/\s*_\(by.*?\)_\s*$/, "").trim()
      if (description) {
        const result = await completeActionItemByText(description, WORKSPACE_ID)
        if (result.updated > 0) completed++
      }
      continue
    }

    // [follow-up: Name] plan text
    const followUpMatch = trimmed.match(/^\[follow-up:\s*([^\]]+)\]\s*(.+)/)
    if (followUpMatch) {
      const personName = followUpMatch[1].trim()
      const planText = followUpMatch[2].trim()
      const person = await findPersonByName(personName, WORKSPACE_ID)
      await createPlan({ text: planText, personId: person?.id }, WORKSPACE_ID)
      plansCreated++
      continue
    }

    // [note: Name] note text
    const noteMatch = trimmed.match(/^\[note:\s*([^\]]+)\]\s*(.+)/)
    if (noteMatch) {
      const personName = noteMatch[1].trim()
      const noteText = noteMatch[2].trim()
      const person = await findPersonByName(personName, WORKSPACE_ID)
      if (person) {
        await appendPersonNote(person.id, noteText, WORKSPACE_ID)
        notesAdded++
      }
      continue
    }
  }

  console.log(`[brief:execute] completed=${completed} plansCreated=${plansCreated} notesAdded=${notesAdded}`)
}

function parseBriefPath(arg?: string): string {
  if (arg) return path.resolve(arg)
  const today = new Date().toISOString().slice(0, 10)
  return path.join(BRIEFS_DIR, `${today}.md`)
}

function loadEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "apps/persons/.env"),
    path.join(process.cwd(), "apps/persons/.env.local"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) dotenv.config({ path: candidate, quiet: true })
  }
}

main().catch(async error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  if (db) await db.$disconnect()
  process.exit(1)
})
