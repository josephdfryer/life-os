-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "mode" TEXT NOT NULL DEFAULT 'suggest',
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actions" TEXT NOT NULL DEFAULT '[]',
    "stopProcessing" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    CONSTRAINT "Rule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RuleRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "matched" BOOLEAN NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" TEXT,
    "actionsPlanned" TEXT,
    "actionsApplied" TEXT,
    "message" TEXT,
    CONSTRAINT "RuleRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Rule_trigger_status_priority_idx" ON "Rule"("trigger", "status", "priority");
CREATE INDEX "Rule_createdByUserId_idx" ON "Rule"("createdByUserId");

-- CreateIndex
CREATE INDEX "RuleRun_ruleId_createdAt_idx" ON "RuleRun"("ruleId", "createdAt");
CREATE INDEX "RuleRun_trigger_createdAt_idx" ON "RuleRun"("trigger", "createdAt");
CREATE INDEX "RuleRun_matched_createdAt_idx" ON "RuleRun"("matched", "createdAt");
CREATE INDEX "RuleRun_targetType_targetId_idx" ON "RuleRun"("targetType", "targetId");
