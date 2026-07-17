# Workflow replay runbook

1. Identify the failed `runId`, workflow, workspace, target connection, checkpoint, and last successfully persisted item.
2. Estimate the replay window and record count. Confirm that provider IDs and database unique constraints make the path idempotent.
3. Back up affected core data when the replay can update existing records. Never truncate or reset a core table.
4. Prefer the normal bounded sync command with its checkpoint intact. Only reset a cursor through a reviewed domain operation when the provider requires a full resync.
5. Monitor the new `runId`, terminal status, counters, and audit records. Compare created/updated/skipped totals with the estimate.
6. Stop if duplicates, cross-workspace records, or unexpectedly large writes appear; preserve evidence and restore using `DATABASE_MIGRATION_AND_RECOVERY.md` if necessary.
