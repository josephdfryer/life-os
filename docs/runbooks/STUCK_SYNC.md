# Stuck or failed sync runbook

1. Read the connection status: `syncHealth.stale`, `syncHealth.ageMs`, `syncHealth.failing`, and `lastError`.
2. Find structured `workflow.run` records by returned `runId`; compare the start record with the terminal status, duration, counters, and error.
3. If status is `partial`, preserve the existing checkpoint. Gmail intentionally advances `historyId` only after a complete run.
4. Verify provider connectivity and token expiry with a read-only request. Do not reconnect or replace credentials before confirming an auth failure.
5. Check database migration state and connection fields before changing application logic.
6. Retry one bounded run. If it fails, retain the run ID and counters for diagnosis.

Never clear a sync cursor/checkpoint casually: doing so may replay a large provider history. Follow the replay runbook and estimate scope first.
