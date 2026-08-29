-- Finance as Interactions — see docs/FINANCE_INTERACTION_MODEL_PLAN.md
--
-- Financial transactions stop living in the StagedInteraction review queue and
-- become canonical Interactions the moment they land. Context (Place, Event,
-- beneficiaries) attaches later through InteractionParticipant, which now
-- carries provenance so enrichment is safely re-runnable forever.
--
-- Purely additive: ADD COLUMN + CREATE INDEX only. No table rebuild, no data
-- movement, no column retyped. Safe on a populated database.

-- ── Interaction: make a transaction self-sufficient ─────────────────────────

-- Provenance / dedupe anchor. Lets any source write straight to Interaction
-- idempotently instead of routing through a human gate.
ALTER TABLE "Interaction" ADD COLUMN "source" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "sourceId" TEXT;

-- Money. `amount` (cents) and `direction` already exist.
ALTER TABLE "Interaction" ADD COLUMN "subtype" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Interaction" ADD COLUMN "category" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "merchantName" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "accountLinkId" TEXT REFERENCES "EraAccountLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Whose money moved. A cache of EraAccountLink.ownerPersonId, which stays
-- authoritative; exists as a column because cash/manual interactions have no
-- account to derive from.
ALTER TABLE "Interaction" ADD COLUMN "actorPersonId" TEXT REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Structured source detail as JSON. `notes` is human-written prose and must
-- never carry structured data (apps/assistant/lib/finance.ts used to parse it).
ALTER TABLE "Interaction" ADD COLUMN "metadata" TEXT;

-- Enrichment state. Bump enrichmentVersion to force a reconciler revisit.
ALTER TABLE "Interaction" ADD COLUMN "enrichmentVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Interaction" ADD COLUMN "enrichedAt" DATETIME;

-- SQLite treats NULLs as distinct in a unique index, so the existing rows with
-- no source/sourceId do not collide. Sourced rows dedupe exactly.
CREATE UNIQUE INDEX "Interaction_workspaceId_source_sourceId_key" ON "Interaction"("workspaceId", "source", "sourceId");

-- Keyset stream: filter on workspace, order by timestamp, tie-break on id.
CREATE INDEX "Interaction_workspaceId_timestamp_id_idx" ON "Interaction"("workspaceId", "timestamp" DESC, "id");
CREATE INDEX "Interaction_workspaceId_type_timestamp_idx" ON "Interaction"("workspaceId", "type", "timestamp" DESC);
CREATE INDEX "Interaction_workspaceId_actorPersonId_timestamp_idx" ON "Interaction"("workspaceId", "actorPersonId", "timestamp" DESC);
CREATE INDEX "Interaction_workspaceId_category_timestamp_idx" ON "Interaction"("workspaceId", "category", "timestamp" DESC);
CREATE INDEX "Interaction_accountLinkId_idx" ON "Interaction"("accountLinkId");

-- Partial indexes for the hot slice. Roughly a third the size of the full
-- index and chosen automatically by the planner for finance queries.
-- Prisma cannot express these, so they live only here and in the Turso script.
CREATE INDEX "Interaction_financial_stream_idx" ON "Interaction"("workspaceId", "timestamp" DESC, "id") WHERE "type" = 'financial';
CREATE INDEX "Interaction_financial_category_idx" ON "Interaction"("workspaceId", "category", "timestamp" DESC) WHERE "type" = 'financial';

-- ── InteractionParticipant: late-bound context with provenance ──────────────

ALTER TABLE "InteractionParticipant" ADD COLUMN "confidence" REAL;
ALTER TABLE "InteractionParticipant" ADD COLUMN "band" TEXT;
ALTER TABLE "InteractionParticipant" ADD COLUMN "source" TEXT;
ALTER TABLE "InteractionParticipant" ADD COLUMN "evidence" TEXT;
-- Turso/libSQL rejects a non-constant default (CURRENT_TIMESTAMP) on ADD COLUMN,
-- so these land with an epoch sentinel and are backfilled from the parent
-- Interaction below. Prisma supplies both values on every write.
ALTER TABLE "InteractionParticipant" ADD COLUMN "createdAt" DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE "InteractionParticipant" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

UPDATE "InteractionParticipant"
   SET "createdAt" = COALESCE((SELECT "createdAt" FROM "Interaction" WHERE "Interaction"."id" = "InteractionParticipant"."interactionId"), "createdAt"),
       "updatedAt" = COALESCE((SELECT "createdAt" FROM "Interaction" WHERE "Interaction"."id" = "InteractionParticipant"."interactionId"), "updatedAt")
 WHERE "createdAt" = '1970-01-01T00:00:00.000Z';

-- Upsert key for the reconciler.
CREATE UNIQUE INDEX "InteractionParticipant_interactionId_entityType_entityId_role_key" ON "InteractionParticipant"("interactionId", "entityType", "entityId", "role");
CREATE INDEX "InteractionParticipant_entityType_entityId_interactionId_idx" ON "InteractionParticipant"("entityType", "entityId", "interactionId");
CREATE INDEX "InteractionParticipant_workspaceId_entityType_entityId_idx" ON "InteractionParticipant"("workspaceId", "entityType", "entityId");

-- ── EraAccountLink: the ownership anchor ────────────────────────────────────
-- Declared once per account (11 rows), never per transaction.

ALTER TABLE "EraAccountLink" ADD COLUMN "ownerPersonId" TEXT REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EraAccountLink" ADD COLUMN "householdGroupId" TEXT REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EraAccountLink" ADD COLUMN "isShared" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "EraAccountLink_ownerPersonId_idx" ON "EraAccountLink"("ownerPersonId");
CREATE INDEX "EraAccountLink_householdGroupId_idx" ON "EraAccountLink"("householdGroupId");
