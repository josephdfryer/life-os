# Life OS Companion release runbook

No collector or LaunchAgent is retired merely because the app builds. A release is complete only after the checks below.

## Build prerequisites

- Xcode 16 or newer with macOS 14 and iOS 17 SDKs.
- An Apple Developer team with the Mac, helper, and iOS bundle identifiers provisioned.
- Developer ID Application and Developer ID Installer certificates for direct Mac distribution.
- An Apple Distribution profile for real-device iOS testing.
- A Sparkle EdDSA key pair. Put only the public key in `SPARKLE_PUBLIC_ED_KEY`; keep the private key out of the repository.

Open `apps/companion/LifeOSCompanion.xcodeproj`, set `DEVELOPMENT_TEAM`, and resolve the local package plus Sparkle 2. A release build deliberately has an empty Sparkle public key until release engineering supplies it; the updater does not start in that state.

## Clean-account Mac acceptance

1. Install on a clean macOS user with no repository, Node, Homebrew, Python, `.env`, or hand-installed plist.
2. Confirm web sign-in returns to the app and tokens survive restart.
3. Grant, deny, revoke, and restore Full Disk Access and Photos/folder permissions. Confirm safe error codes; diagnostics must contain no content or paths.
4. Disconnect networking, collect records, restart both app and helper, reconnect, and confirm the pending count drains with no duplicates.
5. Revoke the device through the API/Home management surface and confirm refresh plus ingest fail.

## Connector shadow cutover

For iMessage and WhatsApp, initialize the app watermark, keep the matching legacy LaunchAgent running, and compare stable source IDs for at least seven days. Do not write both pipelines into canonical records during comparison. Record counts, missing IDs, schema versions, and permission interruptions.

Only after parity is accepted:

1. Run `npm run backup:people`.
2. Disable the single superseded LaunchAgent. Do not remove its plist or historical state.
3. Verify 24 hours of app-only collection.
4. Roll back by re-enabling that one LaunchAgent if any gap appears.

Never delete Person, Interaction, Event, Place, State, Note, Group, Plan, or Workspace data during migration.

## iPhone real-device acceptance

Run initial HealthKit sync, incremental observer delivery, authorization changes, deletions, workout ingestion, approximate location, removal of Always access, offline queueing, and a seven-day battery run. Confirm the app presents genuine health/location context rather than functioning only as background extraction.

## Signing, notarization, and Sparkle

Archive the Mac app with Hardened Runtime. Sign the nested login item before the parent app, notarize the final archive with `notarytool`, staple the ticket, and verify with `spctl`. Sign Sparkle archives with Sparkle's `sign_update`, publish the HTTPS appcast, test an upgrade that migrates an existing outbox, and retain the previous signed archive for rollback.

Production release remains blocked until Developer ID identity, notarization credentials, Sparkle public key/feed publication, and real-device evidence are present.

## Current verification record

On 2026-08-11, Xcode 26.6 (build 17F113) resolved Sparkle 2.9.5 and successfully built the macOS app, embedded collector, and generic iPhone device target with code signing disabled. The shared Swift package tests passed, including encrypted outbox startup, stable-ID deduplication, checkpoint round-trip, removal, and an assertion that normalized private content is not present in plaintext in SQLite.

This is compiler and local persistence evidence, not release acceptance. The machine reported no valid code-signing identities, so signed installation, background-service approval, protected-data permissions, browser sign-in, notarization, Sparkle update verification, and real-device HealthKit/location behavior remain open.
