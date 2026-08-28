-- AlterTable: add priority and enrichedAt to StagedInteraction
ALTER TABLE "StagedInteraction" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "StagedInteraction" ADD COLUMN "enrichedAt" DATETIME;

-- CreateIndex: replace status+createdAt index with status+priority+createdAt
DROP INDEX IF EXISTS "StagedInteraction_status_createdAt_idx";
CREATE INDEX "StagedInteraction_status_priority_createdAt_idx" ON "StagedInteraction"("status", "priority", "createdAt");

-- Seed: auto-approve rule for high-confidence matches (idempotent via fixed id)
INSERT OR IGNORE INTO "Rule" (
  "id", "workspaceId", "name", "description",
  "trigger", "status", "priority", "mode",
  "conditions", "actions", "stopProcessing",
  "createdAt", "updatedAt"
) VALUES (
  'seed-auto-approve-confidence',
  'default-workspace',
  'Auto-approve high-confidence matches',
  'Automatically accept inbox items where Claude matched with ≥90% confidence.',
  'inbox.stage',
  'active',
  1,
  'auto',
  '[{"field":"confidence","operator":"gte","value":90}]',
  '[{"type":"set","field":"status","value":"accepted"}]',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
