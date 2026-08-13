# Life OS Companion architecture

Life OS Companion is the owned-device collection boundary for Life OS. It is one native project with a macOS control centre, an embedded macOS login item, an iOS companion, and the local Swift package `LifeOSCompanionCore`.

It adds no life primitive. `Device`, `DeviceSource`, `DeviceCredential`, `DeviceAuthorization`, and `DeviceIngestItem` are operational records around the eight primitives.

**This is personal-line infrastructure.** Everything below describes a device→cloud pipeline in which the cloud database is canonical: collectors normalize on the device and `POST /v1/device/ingest` to the server, which runs the canonical commands. [ADR 0004](adr/0004-customer-life-vault.md) chose the opposite boundary for *customers* — a local Life Vault where the graph never leaves the device and Life OS servers receive no graph content. Both are correct for their own audience, and the distinction matters before anyone builds on this:

- The trust and authorization design (PKCE, hashed rotating credentials, revocation), the encrypted outbox, the checkpoint/replay semantics, the connector implementations, and the local privacy boundary all **carry over** to a vault-backed customer product essentially unchanged. That engineering is not wasted.
- The **destination** does not carry over. In a customer vault the ingest step writes to the local store rather than to `apps/api`, so the ingest endpoint, the server-side `DeviceIngestItem` receipt, and the server-side dispatch in `apps/api/lib/device-ingest.ts` are personal-line components with local equivalents still to be designed.
- Do not treat this document as the customer collection architecture. It is Joseph's, and Joseph's graph stays cloud-canonical throughout the vault build-out.

```text
Mac source DBs / selected folders        HealthKit / Core Location
              |                                      |
       native connector                         native connector
              +---------------+----------------------+
                              |
                    encrypted SQLite outbox
                    key held in Keychain
                              |
                 POST /v1/device/ingest
                              |
          canonical commands / existing review queues
                              |
       Person Place Item Event Plan Group State Note
                      via Interaction
```

## Trust and authorization

1. The app creates a PKCE verifier and opens `https://home.lacollecteur.com/device/authorize` with `ASWebAuthenticationSession`.
2. Home uses the existing signed-in web account, shows the device and privacy boundary, and creates a ten-minute, one-use authorization code.
3. `POST /v1/device/auth/exchange` verifies PKCE and returns an opaque 15-minute access token plus a rotating 90-day refresh token.
4. Only SHA-256 token hashes are stored. Rotation revokes the old credential atomically. Device revocation invalidates every credential.

The registered callback is exactly `lifeos-companion://auth/callback`; arbitrary redirects are rejected. Native credentials live in Keychain with `AfterFirstUnlockThisDeviceOnly` accessibility.

## Ingestion protocol

`POST /v1/device/ingest` accepts protocol version 1 and at most 200 items. Each item has `deviceId`, `source`, stable `sourceId`, `schemaVersion`, `observedAt`, and one discriminated normalized record. Supported v1 records are daily health aggregates, workout summaries, derived visits, communications, document metadata/extracted text, photo metadata, and voice transcripts.

`DeviceIngestItem(workspaceId, source, sourceId)` is the server receipt. Replaying identical content returns `duplicate`; reusing a source ID for different content returns `source_id_conflict`. Items run sequentially so order within a source is retained. Responses are per item: `accepted`, `duplicate`, `retryable`, or `rejected`.

Messages enter `StagedInteraction`; visits enter `ImportStagedVisit`; both index into the universal `ReviewItem` inbox. Daily health aggregates enter the existing State taxonomy. Workouts become Events. Transcripts and metadata become provenance-bearing Notes. Graph changes and receipts share a transaction where the destination command permits it.

The in-progress legacy `POST /v1/health/samples` route remains untouched. Before that route is committed, its daily-health write should be moved onto the same helper as `health.daily`; until then, taxonomy compatibility is enforced by the accepted metric-key list in `apps/api/lib/device-ingest.ts`.

## Local privacy boundary

Allowed off-device: normalized message text, voice transcripts, derived visits, daily health aggregates, workout summaries, selected document text, and photo metadata.

Never uploaded by v1: source SQLite databases, file paths, attachments, recordings, granular HealthKit samples, raw GPS pings, workout routes, photo bytes, secrets, or local logs. Zod contracts reject extra fields. The outbox encrypts every payload and checkpoint with AES-GCM; its key never enters SQLite.

## Connector lifecycle

First-run checkpoints begin at the current maximum source row. Backfill is therefore off by default. iMessage stable IDs match the current script's message row ID; WhatsApp uses stanza ID with row ID fallback. The WhatsApp collector verifies required tables and columns and reports an unsupported schema instead of guessing.

Legacy collectors are not disabled by installing this project. For each connector: run shadow comparison, compare stable IDs, resolve gaps, then explicitly disable only that LaunchAgent. Rollback is re-enabling that LaunchAgent. No historical data is removed.

## Current implementation boundary

The committed foundation includes native shells, PKCE sign-in, credential rotation, encrypted outbox/checkpoints, ordered retry upload, heartbeat status, an `SMAppService` login item, incremental iMessage/WhatsApp reads, HealthKit daily/workout collection, and significant-change/visit location capture.

Documents, voice-folder watching, Photos metadata collection, call-history experimentation, connector-specific repair screens, diagnostics export, cloud schedules, and multi-device Home UI remain subsequent slices. Sparkle 2 is linked and guarded until a real EdDSA public key is supplied.

## Source map

- Native project: `apps/companion/LifeOSCompanion.xcodeproj`
- Shared package: `apps/companion/Packages/LifeOSCompanionCore`
- Browser authorization: `apps/home/app/device/authorize` and `apps/home/app/api/device/authorize`
- Device API: `apps/api/app/v1/device` and `apps/api/app/v1/devices`
- Ingestion dispatch: `apps/api/lib/device-ingest.ts`
- Database models: `packages/db/prisma/schema.prisma`
- Wire contracts: `packages/contracts/index.ts`

