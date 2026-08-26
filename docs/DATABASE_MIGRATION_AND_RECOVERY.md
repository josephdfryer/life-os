# Database Migration and Recovery Runbook

LifeOS treats the Prisma migration directory as the ordered database history.
Production data is not a migration test fixture. Every migration must first pass
the clean replay and synthetic upgrade/restore gates in CI.

## Canonical change workflow

1. Change `packages/db/prisma/schema.prisma`.
2. Create a named migration with Prisma against a disposable local database.
3. Review the SQL, especially table rebuilds, foreign-key actions, defaults, and
   conversions. Never use `db push --force-reset`.
4. Run `npm run generate -w @life-os/db`, `npm run db:drill`, the unit tests,
   and the critical E2E suite.
5. Commit the schema, migration, generated client, tests, and any conversion
   notes together.
6. Before production deployment, create a provider-managed snapshot or full
   logical dump, record its immutable identifier and row-count checks, and test
   opening/restoring it into a separate database.
7. Apply migrations with the supported Prisma deployment command from a pinned
   commit. Do not run one-off `ALTER TABLE` statements from an app shell.
8. Verify `_prisma_migrations`, `PRAGMA foreign_key_check`, expected row counts,
   and one read-only application smoke test before enabling new writes.

The repository contains older `turso-migrate-*.ts` and
`scripts/apply-migration.ts` utilities. They are historical drift-repair tools,
not the canonical path for new changes. Do not rerun them unless a reviewed
incident plan names the exact script, database, backup, and expected effects.

## Local proof commands

```bash
DATABASE_URL="file:$(node -p 'require("os").tmpdir()')/life-os-clean.db" npm run migrate:deploy -w @life-os/db
npm run db:drill
npm run test
npm run e2e
```

`db:drill` uses only synthetic data under the OS temp directory. It builds the schema
up to a real historical boundary, inserts representative Person, Interaction,
and Item rows, applies the remaining migrations, verifies money conversion and
foreign keys, copies a backup, restores it separately, and repeats integrity
checks.

## Production preflight record

Capture these fields in the release or incident ticket:

- commit SHA and migration names;
- target database hostname and database identifier (never the auth token);
- snapshot/dump identifier, creation time, encryption/retention location;
- pre-migration counts for all tables touched;
- migration owner and rollback decision-maker;
- expected lock/write-impact window;
- post-migration queries and application smoke test;
- recovery point and recovery-time objectives for this release.

Until measured restore drills establish tighter numbers, use conservative pilot
targets of **RPO 24 hours** and **RTO 4 hours**. A release that cannot meet its
recorded objectives must not make an irreversible data-format change.

## Failed migration response

1. Stop deploy promotion and disable only the affected write path. Do not retry
   an unknown partial migration from multiple terminals.
2. Preserve logs and query `_prisma_migrations` plus the actual table/index
   shape. Record exactly which statements completed.
3. If no destructive statement completed, correct the migration and follow the
   documented Prisma `migrate resolve` procedure only after review.
4. If data or table shape changed, restore the verified snapshot into a new
   database first. Run integrity checks and row-count comparisons there.
5. Point a non-production deployment at the restored database and run read-only
   smoke tests. Promote/switch only after the owner approves the evidence.
6. Never use `prisma db push --force-reset`, truncate a core table, or bulk-delete
   graph data as recovery.

## Restore drill checklist

- Restore into a new database; never overwrite the only source copy.
- Verify the artifact checksum or provider snapshot identifier.
- Run database integrity and foreign-key checks.
- Compare critical table counts: Workspace, Person, Interaction, Event, Plan,
  Place, State, Group, Note, and Item.
- Sample relationship traversal and encrypted integration-token readability.
- Run application smoke tests with writes disabled.
- Record elapsed time, data cutoff, discrepancies, and the go/no-go decision.

