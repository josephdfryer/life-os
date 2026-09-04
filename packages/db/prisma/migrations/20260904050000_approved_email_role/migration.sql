-- Shared-workspace invitations carry the role that will be granted on first sign-in.
-- Standalone invitations leave roleId null because their user owns the new workspace.
ALTER TABLE "ApprovedEmail" ADD COLUMN "roleId" TEXT;

ALTER TABLE "ApprovedEmail"
ADD CONSTRAINT "ApprovedEmail_roleId_fkey"
FOREIGN KEY ("roleId") REFERENCES "Role"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ApprovedEmail_roleId_idx" ON "ApprovedEmail"("roleId");
