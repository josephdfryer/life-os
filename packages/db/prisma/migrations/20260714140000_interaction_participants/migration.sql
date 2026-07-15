-- Typed participant edge for Interaction — lets Group, Plan, State, Note, and
-- Item join as full participants alongside the existing direct
-- personId/eventId/placeId fields on Interaction, which are kept as-is.

-- CreateTable
CREATE TABLE "InteractionParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interactionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" TEXT,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "InteractionParticipant_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InteractionParticipant_interactionId_idx" ON "InteractionParticipant"("interactionId");

-- CreateIndex
CREATE INDEX "InteractionParticipant_entityType_entityId_idx" ON "InteractionParticipant"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "InteractionParticipant_workspaceId_idx" ON "InteractionParticipant"("workspaceId");
