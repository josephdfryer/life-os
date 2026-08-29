-- CreateIndex
CREATE INDEX "Interaction_personId_timestamp_idx" ON "Interaction"("personId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Interaction_timestamp_idx" ON "Interaction"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "Person_last_first_idx" ON "Person"("last", "first");

-- CreateIndex
CREATE INDEX "Person_email_idx" ON "Person"("email");

-- CreateIndex
CREATE INDEX "Person_closeness_idx" ON "Person"("closeness");

-- CreateIndex
CREATE INDEX "Person_birthday_idx" ON "Person"("birthday");

-- CreateIndex
CREATE INDEX "Person_createdAt_idx" ON "Person"("createdAt");
