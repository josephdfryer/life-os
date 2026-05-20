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
        await markActionItemComplete(description)
        completed++
      }
      continue
    }

    // [follow-up: Name] plan text
    const followUpMatch = trimmed.match(/^\[follow-up:\s*([^\]]+)\]\s*(.+)/)
    if (followUpMatch) {
      const personName = followUpMatch[1].trim()
      const planText = followUpMatch[2].trim()
      await createPlan(planText, personName)
      plansCreated++
      continue
    }

    // [note: Name] note text
    const noteMatch = trimmed.match(/^\[note:\s*([^\]]+)\]\s*(.+)/)
    if (noteMatch) {
      const personName = noteMatch[1].trim()
      const noteText = noteMatch[2].trim()
      await appendPersonNote(personName, noteText)
      notesAdded++
      continue
    }
  }

  console.log(`[brief:execute] completed=${completed} plansCreated=${plansCreated} notesAdded=${notesAdded}`)
}

async function markActionItemComplete(description: string) {
  const interactions = await db.interaction.findMany({
    where: {
      workspaceId: WORKSPACE_ID,
      actionItems: { contains: description.slice(0, 50) },
    },
    select: { id: true, actionItems: true },
    take: 5,
  })

  for (const interaction of interactions) {
    const items = safeJsonArray<{ description: string; completed?: boolean }>(interaction.actionItems)
    const updated = items.map(item =>
      item.description.toLowerCase().includes(description.toLowerCase().slice(0, 40))
        ? { ...item, completed: true }
        : item
    )
    await db.interaction.update({
      where: { id: interaction.id },
      data: { actionItems: JSON.stringify(updated) },
    })
  }
}

async function createPlan(planText: string, personName: string) {
  const personId = await resolvePersonId(personName)
  await db.plan.create({
    data: {
      workspaceId: WORKSPACE_ID,
      text: planText,
      personId,
      status: "active",
    },
  })
}

async function appendPersonNote(personName: string, noteText: string) {
  const personId = await resolvePersonId(personName)
  if (!personId) return

  const person = await db.person.findUnique({
    where: { id: personId },
    select: { notes: true },
  })
  if (!person) return

  const existing = person.notes?.trim() ?? ""
  const dated = `[${new Date().toISOString().slice(0, 10)}] ${noteText}`
  await db.person.update({
    where: { id: personId },
    data: { notes: existing ? `${existing}\n${dated}` : dated },
  })
}

async function resolvePersonId(name: string): Promise<string | null> {
  const [first, ...rest] = name.trim().split(/\s+/)
  const last = rest.join(" ")
  const persons = await db.person.findMany({
    where: {
      workspaceId: WORKSPACE_ID,
      first: { equals: first },
      ...(last ? { last: { equals: last } } : {}),
    },
    select: { id: true },
    take: 1,
  })
  return persons[0]?.id ?? null
}

function safeJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
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
