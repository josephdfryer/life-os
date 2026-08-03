import { createClient, type Client } from "@libsql/client"

const migrationName = "20260728020000_add_workout_layer"

// Idempotent production apply for the Level Up workout layer. Mirrors
// prisma/migrations/20260728020000_add_workout_layer. Additive throughout:
// new tables, new nullable columns, and three NOT NULL columns with defaults
// (safe on a populated table in SQLite).
//
// MUST run before deploying level-up. The regenerated Prisma client selects
// every scalar column of a model by default, so shipping code that knows about
// LevelUpTrainingSet.setIndex against a DB without it fails every query on that
// model, not just the new screens.
//
//   cd packages/db && DB=persons; \
//     TURSO_DATABASE_URL="$(turso db show "$DB" --url)" \
//     TURSO_AUTH_TOKEN="$(turso db tokens create "$DB")" \
//     npx tsx turso-migrate-workout-layer.ts

async function addColumnIfMissing(client: Client, table: string, column: string, definition: string) {
  const result = await client.execute({
    sql: `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  })
  if (result.rows.length === 0) {
    console.log(`  Adding ${table}.${column}...`)
    await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
  } else {
    console.log(`  ${table}.${column} already present.`)
  }
}

const TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "LevelUpExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "modality" TEXT NOT NULL DEFAULT 'load',
    "catalogKey" TEXT,
    "defaultRestSec" INTEGER NOT NULL DEFAULT 90,
    "muscleGroup" TEXT,
    "jointLoad" TEXT,
    "substituteId" TEXT,
    CONSTRAINT "LevelUpExercise_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LevelUpExercise_substituteId_fkey"
      FOREIGN KEY ("substituteId") REFERENCES "LevelUpExercise"("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "LevelUpProgram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "LevelUpProgram_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "LevelUpProgramDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LevelUpProgramDay_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LevelUpProgramDay_programId_fkey"
      FOREIGN KEY ("programId") REFERENCES "LevelUpProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "LevelUpProgramEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "programDayId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "targetSets" INTEGER NOT NULL DEFAULT 3,
    "targetReps" INTEGER,
    "targetLoadKg" REAL,
    "targetDurationSec" INTEGER,
    "restSec" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LevelUpProgramEntry_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LevelUpProgramEntry_programDayId_fkey"
      FOREIGN KEY ("programDayId") REFERENCES "LevelUpProgramDay"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LevelUpProgramEntry_exerciseId_fkey"
      FOREIGN KEY ("exerciseId") REFERENCES "LevelUpExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "LevelUpSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "programDayId" TEXT,
    "kneeFlare" BOOLEAN NOT NULL DEFAULT false,
    "lumbarFlare" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    CONSTRAINT "LevelUpSession_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LevelUpSession_programDayId_fkey"
      FOREIGN KEY ("programDayId") REFERENCES "LevelUpProgramDay"("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "LevelUpBodyMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "measuredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weightKg" REAL,
    "bodyFatPct" REAL,
    "musclePct" REAL,
    "notes" TEXT,
    CONSTRAINT "LevelUpBodyMetric_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
]

const INDEXES: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "LevelUpExercise_workspaceId_key_key" ON "LevelUpExercise"("workspaceId", "key")`,
  `CREATE INDEX IF NOT EXISTS "LevelUpExercise_workspaceId_idx" ON "LevelUpExercise"("workspaceId")`,
  `CREATE INDEX IF NOT EXISTS "LevelUpProgram_workspaceId_isActive_idx" ON "LevelUpProgram"("workspaceId", "isActive")`,
  `CREATE INDEX IF NOT EXISTS "LevelUpProgramDay_programId_order_idx" ON "LevelUpProgramDay"("programId", "order")`,
  `CREATE INDEX IF NOT EXISTS "LevelUpProgramDay_workspaceId_idx" ON "LevelUpProgramDay"("workspaceId")`,
  `CREATE INDEX IF NOT EXISTS "LevelUpProgramEntry_programDayId_order_idx" ON "LevelUpProgramEntry"("programDayId", "order")`,
  `CREATE INDEX IF NOT EXISTS "LevelUpProgramEntry_workspaceId_idx" ON "LevelUpProgramEntry"("workspaceId")`,
  `CREATE INDEX IF NOT EXISTS "LevelUpSession_workspaceId_startedAt_idx" ON "LevelUpSession"("workspaceId", "startedAt")`,
  `CREATE INDEX IF NOT EXISTS "LevelUpBodyMetric_workspaceId_measuredAt_idx" ON "LevelUpBodyMetric"("workspaceId", "measuredAt")`,
  `CREATE INDEX IF NOT EXISTS "LevelUpTrainingSet_workspaceId_exerciseId_performedAt_idx" ON "LevelUpTrainingSet"("workspaceId", "exerciseId", "performedAt")`,
]

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")
    process.exit(1)
  }

  const client = createClient({ url, authToken })
  try {
    for (const statement of TABLES) await client.execute(statement)
    console.log("  Workout tables ensured.")

    await addColumnIfMissing(client, "LevelUpTrainingSet", "exerciseId", "TEXT")
    await addColumnIfMissing(client, "LevelUpTrainingSet", "setIndex", "INTEGER")
    await addColumnIfMissing(client, "LevelUpTrainingSet", "durationSec", "INTEGER")
    await addColumnIfMissing(client, "LevelUpTrainingSet", "isBodyweight", "BOOLEAN NOT NULL DEFAULT false")
    await addColumnIfMissing(client, "LevelUpTrainingSet", "rpe", "REAL")

    await addColumnIfMissing(client, "LevelUpProfile", "unitPreference", "TEXT NOT NULL DEFAULT 'lb'")
    await addColumnIfMissing(client, "LevelUpProfile", "microPlates", "BOOLEAN NOT NULL DEFAULT false")
    await addColumnIfMissing(client, "LevelUpProfile", "activeProgramId", "TEXT")

    for (const statement of INDEXES) await client.execute(statement)
    console.log("  Indexes ensured.")

    const tables = await client.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
        ('LevelUpExercise','LevelUpProgram','LevelUpProgramDay','LevelUpProgramEntry','LevelUpSession','LevelUpBodyMetric')`,
    )
    if (tables.rows.length !== 6) {
      throw new Error(`Expected 6 workout tables, found ${tables.rows.length}`)
    }
    const columns = await client.execute(
      `SELECT name FROM pragma_table_info('LevelUpTrainingSet')
        WHERE name IN ('exerciseId','setIndex','durationSec','isBodyweight','rpe')`,
    )
    if (columns.rows.length !== 5) {
      throw new Error(`Expected 5 new LevelUpTrainingSet columns, found ${columns.rows.length}`)
    }

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
