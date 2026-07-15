#!/usr/bin/env tsx

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import type { PrismaClient } from "@life-os/db"

const require = createRequire(import.meta.url)
const dotenv = require("dotenv") as { config(options: { path: string; quiet?: boolean }): void }
loadEnv()

const REPO_ROOT = path.resolve(import.meta.dirname, "..")
const ARCHIVE_DIR = path.join(REPO_ROOT, "archive")
const WORKSPACE_ID = process.env.SYNTHESIS_WORKSPACE_ID ?? "default-workspace"

let db: PrismaClient

async function main() {
  db = (await import("@life-os/db")).db

  // Paginated fetch — a single unbounded query against 7000+ people, each
  // pulling their full interaction history, blows past Turso/libSQL's query
  // parameter limit. Batching keeps each query's parameter count bounded.
  const BATCH_SIZE = 500
  async function fetchBatch(skip: number, take: number) {
    return db.person.findMany({
      where: { workspaceId: WORKSPACE_ID },
      include: {
        interactions: {
          select: { id: true, type: true, timestamp: true, summary: true, emotionalWeight: true, outcome: true },
          orderBy: { timestamp: "desc" },
        },
      },
      orderBy: { createdAt: "asc" },
      skip,
      take,
    })
  }

  const people: Awaited<ReturnType<typeof fetchBatch>> = []
  let skip = 0
  for (;;) {
    const batch = await fetchBatch(skip, BATCH_SIZE)
    people.push(...batch)
    if (batch.length < BATCH_SIZE) break
    skip += BATCH_SIZE
  }

  const date = new Date().toISOString().slice(0, 10)
  const filename = `people-${date}.json`
  const outPath = path.join(ARCHIVE_DIR, filename)

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify({ exportedAt: new Date().toISOString(), count: people.length, people }, null, 2))

  console.log(`[backup] Exported ${people.length} people → archive/${filename}`)

  await db.$disconnect()
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
