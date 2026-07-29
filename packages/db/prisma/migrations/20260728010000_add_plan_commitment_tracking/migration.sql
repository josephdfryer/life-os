-- Commitment tracking on Plan.
--
-- `dueOn` is the day I declared I would do the thing — a promise to myself,
-- distinct from `scheduledStart`, which is a calendar-backed prediction with a
-- real time. `deferCount` records how many times a commitment has been pushed;
-- Home uses it to stop offering snooze and force schedule-or-drop.
ALTER TABLE "Plan" ADD COLUMN "dueOn" DATETIME;
ALTER TABLE "Plan" ADD COLUMN "deferCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN "completedAt" DATETIME;

CREATE INDEX "Plan_workspaceId_status_dueOn_idx" ON "Plan"("workspaceId", "status", "dueOn");
