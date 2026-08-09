CREATE INDEX "Person_workspaceId_createdAt_id_idx"
ON "Person"("workspaceId", "createdAt", "id");

CREATE INDEX "Event_workspaceId_timestamp_id_idx"
ON "Event"("workspaceId", "timestamp" DESC, "id");
