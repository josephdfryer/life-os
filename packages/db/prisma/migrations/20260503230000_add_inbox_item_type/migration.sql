ALTER TABLE "StagedInteraction" ADD COLUMN "itemType" TEXT NOT NULL DEFAULT 'interaction';
CREATE INDEX "StagedInteraction_source_itemType_createdAt_idx" ON "StagedInteraction"("source", "itemType", "createdAt");
