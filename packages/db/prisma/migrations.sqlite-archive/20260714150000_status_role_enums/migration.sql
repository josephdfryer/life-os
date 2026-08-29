-- Plan.status and WorkspaceMember.role become Prisma enums (Plan.status:
-- draft|active|blocked|completed|abandoned, WorkspaceMember.role:
-- owner|admin|member|viewer). SQLite has no native enum type and Prisma's
-- SQLite connector represents enums as plain TEXT columns with no CHECK
-- constraint, so no column-type ALTER is needed here — the values are
-- validated by Prisma Client instead. This migration only normalizes any
-- legacy rows whose stored value falls outside the new enum set, so they
-- don't fail to decode once the client starts enforcing the enum type.

UPDATE "Plan" SET "status" = 'active'
WHERE "status" NOT IN ('draft', 'active', 'blocked', 'completed', 'abandoned');

UPDATE "WorkspaceMember" SET "role" = 'owner'
WHERE "role" NOT IN ('owner', 'admin', 'member', 'viewer');
