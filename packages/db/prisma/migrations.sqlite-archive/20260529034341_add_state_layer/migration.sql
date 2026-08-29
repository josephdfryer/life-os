-- CreateTable
CREATE TABLE "StateDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "State" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "severity" REAL,
    "source" TEXT,
    "recordedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "State_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "StateDefinition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StateDefinition_workspaceId_entityType_idx" ON "StateDefinition"("workspaceId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "StateDefinition_workspaceId_entityType_type_value_key" ON "StateDefinition"("workspaceId", "entityType", "type", "value");

-- CreateIndex
CREATE INDEX "State_workspaceId_entityId_entityType_idx" ON "State"("workspaceId", "entityId", "entityType");

-- CreateIndex
CREATE INDEX "State_workspaceId_entityId_entityType_recordedAt_idx" ON "State"("workspaceId", "entityId", "entityType", "recordedAt");
