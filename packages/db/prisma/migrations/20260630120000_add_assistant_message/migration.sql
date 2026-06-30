-- Migration: add_assistant_message
-- Adds AssistantMessage table for storing WhatsApp ↔ Claude conversation history.

CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "channel" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AssistantMessage_workspaceId_from_createdAt_idx" ON "AssistantMessage"("workspaceId", "from", "createdAt");
