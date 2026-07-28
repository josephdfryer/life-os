import { createClient } from "@libsql/client"

// Idempotent Turso migration for the Level Up module (apps/level-up).
// Run against the shared prod DB BEFORE deploying the app:
//   cd packages/db && DB=persons; \
//     TURSO_DATABASE_URL="$(turso db show "$DB" --url)" \
//     TURSO_AUTH_TOKEN="$(turso db tokens create "$DB")" \
//     npx tsx turso-migrate-level-up.ts
const migrationName = "20260726120000_add_level_up_module"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")
    process.exit(1)
  }

  const client = createClient({ url, authToken })
  try {
    await client.batch(
      [
        `CREATE TABLE IF NOT EXISTS "LevelUpProfile" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "workspaceId" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          "birthDate" DATETIME,
          "sex" TEXT NOT NULL DEFAULT 'male',
          "bodyweightKg" REAL,
          "heightCm" REAL,
          "standingReachCm" REAL,
          "primaryBuild" TEXT,
          "coldStartCompletedAt" DATETIME,
          CONSTRAINT "LevelUpProfile_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "LevelUpProfile_workspaceId_key"
          ON "LevelUpProfile"("workspaceId")`,

        `CREATE TABLE IF NOT EXISTS "LevelUpCombine" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "workspaceId" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "completedAt" DATETIME,
          "label" TEXT,
          "notes" TEXT,
          "block" TEXT,
          CONSTRAINT "LevelUpCombine_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS "LevelUpCombine_workspaceId_completedAt_idx"
          ON "LevelUpCombine"("workspaceId", "completedAt")`,

        `CREATE TABLE IF NOT EXISTS "LevelUpTestResult" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "workspaceId" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "measuredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "testKey" TEXT NOT NULL,
          "value" REAL NOT NULL,
          "bodyweightKg" REAL,
          "populationSource" TEXT NOT NULL DEFAULT 'general',
          "source" TEXT NOT NULL DEFAULT 'combine',
          "protocolFlags" TEXT,
          "context" TEXT,
          "deviceFingerprint" TEXT,
          "combineId" TEXT,
          CONSTRAINT "LevelUpTestResult_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "LevelUpTestResult_combineId_fkey"
            FOREIGN KEY ("combineId") REFERENCES "LevelUpCombine"("id") ON DELETE SET NULL ON UPDATE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS "LevelUpTestResult_workspaceId_testKey_measuredAt_idx"
          ON "LevelUpTestResult"("workspaceId", "testKey", "measuredAt")`,
        `CREATE INDEX IF NOT EXISTS "LevelUpTestResult_combineId_idx"
          ON "LevelUpTestResult"("combineId")`,

        `CREATE TABLE IF NOT EXISTS "LevelUpRatingSnapshot" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "workspaceId" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "combineId" TEXT,
          "engineVersion" TEXT NOT NULL DEFAULT 'v2',
          "ovr" REAL NOT NULL,
          "ratings" TEXT NOT NULL,
          "subRatings" TEXT NOT NULL,
          "buildOvrs" TEXT NOT NULL,
          "badges" TEXT NOT NULL,
          "caps" TEXT NOT NULL,
          CONSTRAINT "LevelUpRatingSnapshot_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "LevelUpRatingSnapshot_combineId_fkey"
            FOREIGN KEY ("combineId") REFERENCES "LevelUpCombine"("id") ON DELETE SET NULL ON UPDATE CASCADE
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "LevelUpRatingSnapshot_combineId_key"
          ON "LevelUpRatingSnapshot"("combineId")`,
        `CREATE INDEX IF NOT EXISTS "LevelUpRatingSnapshot_workspaceId_computedAt_idx"
          ON "LevelUpRatingSnapshot"("workspaceId", "computedAt")`,

        `CREATE TABLE IF NOT EXISTS "LevelUpTrainingSet" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "workspaceId" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "performedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "sessionId" TEXT,
          "exerciseKey" TEXT NOT NULL,
          "reps" INTEGER NOT NULL,
          "loadKg" REAL NOT NULL,
          "bodyweightKg" REAL,
          "rank" REAL,
          "rankLetter" TEXT,
          "balanceResidual" REAL,
          "isPr" INTEGER NOT NULL DEFAULT 0,
          CONSTRAINT "LevelUpTrainingSet_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS "LevelUpTrainingSet_workspaceId_exerciseKey_performedAt_idx"
          ON "LevelUpTrainingSet"("workspaceId", "exerciseKey", "performedAt")`,
        `CREATE INDEX IF NOT EXISTS "LevelUpTrainingSet_workspaceId_sessionId_idx"
          ON "LevelUpTrainingSet"("workspaceId", "sessionId")`,

        `CREATE TABLE IF NOT EXISTS "LevelUpBadgeUnlock" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "workspaceId" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "unlockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "badgeKey" TEXT NOT NULL,
          "tier" TEXT NOT NULL,
          CONSTRAINT "LevelUpBadgeUnlock_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "LevelUpBadgeUnlock_workspaceId_badgeKey_tier_key"
          ON "LevelUpBadgeUnlock"("workspaceId", "badgeKey", "tier")`,
        `CREATE INDEX IF NOT EXISTS "LevelUpBadgeUnlock_workspaceId_unlockedAt_idx"
          ON "LevelUpBadgeUnlock"("workspaceId", "unlockedAt")`,

        `CREATE TABLE IF NOT EXISTS "LevelUpTargetBuild" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "workspaceId" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "buildKey" TEXT NOT NULL,
          "label" TEXT NOT NULL,
          "targets" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'active',
          "achievedAt" DATETIME,
          CONSTRAINT "LevelUpTargetBuild_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "LevelUpTargetBuild_workspaceId_buildKey_key"
          ON "LevelUpTargetBuild"("workspaceId", "buildKey")`,
        `CREATE INDEX IF NOT EXISTS "LevelUpTargetBuild_workspaceId_status_idx"
          ON "LevelUpTargetBuild"("workspaceId", "status")`,
      ],
      "write",
    )

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
