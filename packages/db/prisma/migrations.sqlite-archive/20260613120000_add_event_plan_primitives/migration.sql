-- Migration: add_event_plan_primitives
-- Adds start/end to Event, Plan prediction fields, PlanExpectedPerson junction,
-- and Event nesting + fulfillment relations.

-- ── Event: add start, end, sourcePlanId, parentEventId ──────────────────────

-- start defaults to CURRENT_TIMESTAMP so existing rows get a value, then we backfill from timestamp
ALTER TABLE "Event" ADD COLUMN "start" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Event" ADD COLUMN "end" DATETIME;
ALTER TABLE "Event" ADD COLUMN "sourcePlanId" TEXT;
ALTER TABLE "Event" ADD COLUMN "parentEventId" TEXT;

-- Backfill start from timestamp for all existing rows
UPDATE "Event" SET "start" = "timestamp";

-- ── Plan: add calendar-prediction fields ─────────────────────────────────────

ALTER TABLE "Plan" ADD COLUMN "scheduledStart" DATETIME;
ALTER TABLE "Plan" ADD COLUMN "scheduledEnd" DATETIME;
ALTER TABLE "Plan" ADD COLUMN "placeId" TEXT;
ALTER TABLE "Plan" ADD COLUMN "externalSource" TEXT;
ALTER TABLE "Plan" ADD COLUMN "externalInstanceId" TEXT;

-- ── PlanExpectedPerson junction table ────────────────────────────────────────

CREATE TABLE "PlanExpectedPerson" (
    "planId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    PRIMARY KEY ("planId", "personId"),
    CONSTRAINT "PlanExpectedPerson_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanExpectedPerson_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanExpectedPerson_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX "Event_workspaceId_start_idx" ON "Event"("workspaceId", "start");
CREATE INDEX "Event_sourcePlanId_idx" ON "Event"("sourcePlanId");
CREATE INDEX "Event_parentEventId_idx" ON "Event"("parentEventId");

CREATE UNIQUE INDEX "Plan_externalInstanceId_key" ON "Plan"("externalInstanceId");
CREATE INDEX "Plan_workspaceId_scheduledStart_idx" ON "Plan"("workspaceId", "scheduledStart");
CREATE INDEX "Plan_externalInstanceId_idx" ON "Plan"("externalInstanceId");

CREATE INDEX "PlanExpectedPerson_personId_idx" ON "PlanExpectedPerson"("personId");
CREATE INDEX "PlanExpectedPerson_workspaceId_idx" ON "PlanExpectedPerson"("workspaceId");
