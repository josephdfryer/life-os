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
const TZ = process.env.BRIEF_TIMEZONE ?? "America/Los_Angeles"

let db: PrismaClient

async function main() {
  db = (await import("@life-os/db")).db
  const { getDailySummary } = await import("@life-os/domain")
  const targetDate = parseTargetDate(process.argv[2])
  const dateStr = toLocalDateStr(targetDate)

  const since = startOfDay(targetDate)
  const until = endOfDay(targetDate)

  const { events, interactions, myActionItems: actionItems, activePlans: upcomingPlans } =
    await getDailySummary(WORKSPACE_ID, since, until)

  const lines: string[] = []

  lines.push(`# Daily Brief — ${dateStr}`)
  lines.push("")

  // Summary counts
  const meetingCount = events.filter(e => e.type === "meeting").length
  const callCount = events.filter(e => e.type === "call").length
  const messageCount = interactions.filter(i => i.type === "message").length
  lines.push(`**${meetingCount} meetings · ${callCount} calls · ${messageCount} messages**`)
  lines.push("")

  // Events
  if (events.length > 0) {
    lines.push("## Events")
    for (const event of events) {
      const time = toLocalTimeStr(event.timestamp)
      lines.push(`\n### ${time} — ${event.name}`)
      if (event.place) lines.push(`_📍 ${event.place.name}_`)
      if (event.notes) lines.push(`\n${event.notes}`)

      const participants = event.interactions
        .filter(i => i.person)
        .map(i => {
          const name = [i.person!.first, i.person!.last].filter(Boolean).join(" ")
          const ew = i.emotionalWeight ? ` (weight: ${i.emotionalWeight})` : ""
          const outcome = i.outcome ? ` — ${i.outcome}` : ""
          return `- ${name}${ew}${outcome}`
        })
      if (participants.length > 0) {
        lines.push("\n**Participants:**")
        lines.push(...participants)
      }

      const allActionItems = event.interactions.flatMap(i => safeJsonArray<ActionItem>(i.actionItems))
      if (allActionItems.length > 0) {
        lines.push("\n**Action items:**")
        for (const ai of allActionItems) {
          lines.push(`- [ ] ${ai.description}${ai.deadline ? ` _(by ${ai.deadline})_` : ""}`)
        }
      }
    }
    lines.push("")
  }

  // Standalone interactions
  if (interactions.length > 0) {
    lines.push("## Interactions")
    for (const interaction of interactions) {
      const time = toLocalTimeStr(interaction.timestamp)
      const name = interaction.person
        ? [interaction.person.first, interaction.person.last].filter(Boolean).join(" ")
        : "Unknown"
      const dir = interaction.direction ? ` (${interaction.direction})` : ""
      lines.push(`- ${time} · **${name}**${dir} · ${interaction.type}${interaction.summary ? ` — ${interaction.summary}` : ""}`)
    }
    lines.push("")
  }

  // My action items from the day
  if (actionItems.length > 0) {
    lines.push("## My Action Items")
    for (const ai of actionItems) {
      lines.push(`- [ ] ${ai.description}${ai.deadline ? ` _(by ${ai.deadline})_` : ""}`)
    }
    lines.push("")
  }

  // Active plans
  if (upcomingPlans.length > 0) {
    lines.push("## Active Plans")
    for (const plan of upcomingPlans) {
      const person = plan.person
        ? ` — _${[plan.person.first, plan.person.last].filter(Boolean).join(" ")}_`
        : ""
      const timescale = plan.timescale ? ` [${plan.timescale}]` : ""
      lines.push(`- ${plan.text}${timescale}${person}`)
    }
    lines.push("")
  }

  lines.push("---")
  lines.push("_Annotate with `[x]` to mark complete, `[follow-up: Name]` to log a plan, `[note: Name]` to add a note._")

  const brief = lines.join("\n")
  fs.mkdirSync(BRIEFS_DIR, { recursive: true })
  const outPath = path.join(BRIEFS_DIR, `${dateStr}.md`)
  fs.writeFileSync(outPath, brief)
  console.log(`[brief] Generated: ${outPath}`)
}

type ActionItem = { description: string; deadline?: string }

function safeJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function parseTargetDate(arg?: string): Date {
  if (!arg) return new Date()
  const d = new Date(arg)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${arg}`)
  return d
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function toLocalDateStr(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}

function toLocalTimeStr(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(date)
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
