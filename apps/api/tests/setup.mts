// Loaded via `tsx --test --import ./tests/setup.ts`. Provisions a fresh
// migrated PostgreSQL database for the integration suite before any test file
// imports `@life-os/db`. Node spawns a process per test file, so each file
// gets its own isolated database; the per-run id suffixes the suites already
// use stay harmless.
import { createTestDatabase } from "@life-os/db/testing"

await createTestDatabase()
