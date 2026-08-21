# Granola Events Runbook

## What ships

The Events app owns Granola ingestion. One Granola note maps to one canonical `Event`; `GranolaNoteLink` retains the external note ID, exact source URL, update time, hash, and sync status. The generated summary lives in `Event.metadata.granola`, the complete formatted transcript lives in `Event.transcript`, and user-authored `Event.notes` is never overwritten.

Known attendees are linked to People only by one exact normalized email match. A declined calendar RSVP is not attendance: that Person is skipped and any previously auto-created Granola Interaction for that invite is removed. Each remaining match creates an idempotent Granola `Interaction` and typed Person/Event participant edges. Missing or ambiguous emails create a `StagedInteraction` plus a universal `ReviewItem`; accepting that review attaches the Person to the already-existing meeting Event. No Person or Group is created automatically.

When at least two linked attendees share one uniquely strongest active Group membership, the importer tags the Event with that existing Group and records the evidence. `/groups/[id]/meetings` provides meeting count, people coverage, Granola evidence count, cadence, and the meeting timeline.

## Connect safely

1. In Granola, revoke any API key that has appeared in chat, logs, screenshots, or shell history.
2. Generate a fresh Business/Enterprise API key with the intended personal/public note access.
3. Ensure production has a valid 64-hex-character `ENCRYPTION_KEY`. It must match the key already used for other encrypted connections.
4. Open `/settings/granola` in Events and enter the new key directly. The server validates the key and stores only AES-256-GCM ciphertext in `Connection.accessTokenEncrypted`; the browser never receives it again.
5. Choose **Import all history** for the first run. The importer follows every List Notes cursor and every transcript cursor; there is no fixed record cap.

Do not put a Granola API key in a `NEXT_PUBLIC_` variable, a repository `.env.example`, a URL, or Vercel project configuration as plaintext. The encrypted credential is customer/workspace data in the database.

## Production migration and environment

Apply the additive migration before deploying the Events code:

```bash
cd packages/db
TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx turso-migrate-granola-event-sync.ts
```

Required Events production variables:

- existing Turso and auth variables;
- `ENCRYPTION_KEY` for the connection credential;
- `CRON_SECRET` for Vercel Cron authentication.

The migration creates only `GranolaNoteLink` and its indexes. It does not delete, truncate, or rewrite Events, People, Interactions, Groups, or existing integrations.

## Daily operation

`apps/events/vercel.json` invokes `GET /api/cron/granola-sync` at `0 14 * * *` (14:00 UTC, 06:00 Pacific during standard time and 07:00 during daylight time). Vercel supplies `Authorization: Bearer <CRON_SECRET>`; the route rejects query-string secrets and requests without the exact header.

Incremental sync uses the last successful watermark with a five-minute overlap so boundary edits are re-read safely. The watermark advances only when every note in the run succeeds. Per-note failures are retained on the Connection and the next run retries from the prior watermark. Remote deletion or lost access never deletes the canonical Event.

Operator endpoints:

- `GET /api/granola/status` — connection state, last success/error, and counts; never returns the key.
- `POST /api/granola/sync` — incremental sync; `{ "fullBackfill": true }` re-reads all accessible notes idempotently.
- `POST /api/granola/disconnect` — disables the connection and removes its stored credential; imported graph data remains.

## Verification and recovery

Run:

```bash
npm test --workspace=events
npm run type-check --workspace=events
npm run build --workspace=events
npm run check:migrations
```

After the first production connection, use **Sync now** with the single expected meeting and verify:

1. one Event exists and opens the exact Granola note;
2. the summary and complete collapsed transcript render;
3. exact-email attendees are linked once;
4. unknown or ambiguous attendees appear in review and did not create People;
5. a second sync updates the same Event/Interactions rather than duplicating them;
6. any unambiguous Group link opens the company meeting lens.

If the key is revoked, reconnect with a new key in `/settings/granola`. If a run partially fails, fix the provider/network issue and run an incremental sync; because the watermark did not advance, failed notes are retried. A full backfill is safe when broader reconciliation is needed.

Signed Granola webhooks are intentionally deferred until a stable production receiver is deployed and its one-time signing secret can be captured securely. The daily reconciliation is the current durable automation path.
