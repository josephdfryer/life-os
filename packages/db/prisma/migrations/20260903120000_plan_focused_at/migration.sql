-- Focus queue: a small, date-independent "what I'm actually working on"
-- selection, separate from dueOn/scheduledStart. At most 5 Plans per
-- workspace may have this set at once, enforced at the write layer.
ALTER TABLE "Plan" ADD COLUMN "focusedAt" TIMESTAMP(3);
CREATE INDEX "Plan_workspaceId_status_focusedAt_idx" ON "Plan"("workspaceId", "status", "focusedAt");
