# LifeOS Technical Debt Backlog

This is the ordered execution backlog derived from the July 2026 architecture and maintainability review. Work one task at a time. Update the status, evidence, and completion notes in the same change as the implementation.

## Status key

- `ready` — scoped and ready to start
- `in progress` — active work
- `blocked` — cannot proceed without a decision or external change
- `done` — acceptance criteria verified

## Operating rules

1. Protect correctness, data safety, tenancy, and recovery before developer convenience.
2. Refactor through tested vertical slices; do not perform broad rewrites.
3. Keep the modular monolith unless an extraction meets explicit service criteria.
4. Every task must leave the repository type-safe and must add proportionate verification.
5. Changes to Persons inputs, outputs, APIs, command flow, data models, integrations, or runtime shape must also update `docs/PERSONS_ARCHITECTURE.md`.

## Ordered backlog

### TD-001 — Make linting a real quality gate

- **Status:** done
- **Priority:** P0
- **Effort:** Low–Medium
- **Why:** `npm run lint` currently succeeds while executing zero tasks.
- **Scope:** Add a repository-wide ESLint flat configuration for TypeScript, React, React Hooks, and Next.js; exclude generated/build/private data; make CI run it.
- **Acceptance criteria:**
  - `npm run lint` analyzes authored source and configuration files.
  - The command fails on lint errors and does not report zero tasks.
  - Existing debt is handled explicitly without hiding new errors.
  - `npm run type-check` and `npm run test` still pass.
- **Baseline exceptions to retire in later tasks:** unused-symbol cleanup,
  explicit `any`, expression-style script argument parsing, legacy control-character
  regular expressions, plain internal anchors, image optimization, exhaustive hook
  dependencies, and opt-in React compiler rules. Rules of Hooks remains enforced.

### TD-002 — Add CI build and migration validation

- **Status:** done
- **Priority:** P0
- **Effort:** Low–Medium
- **Why:** CI currently stops after type-check and tests, so production build failures and migration drift can merge.
- **Scope:** Add production builds, Prisma validation, migration-from-zero validation, and generated-client drift checks.
- **Acceptance criteria:** CI proves a clean checkout can generate, migrate, type-check, test, lint, and build.

### TD-003 — Characterize and consolidate access policy

- **Status:** done
- **Priority:** P0
- **Effort:** Medium–High
- **Why:** Persons, Places, and Events contain divergent copies of authorization and workspace-selection policy.
- **Scope:** Add shared contract tests, create `@life-os/access`, and migrate apps without changing intended behavior.
- **Acceptance criteria:** One canonical implementation covers session users, API keys, disabled users, explicit workspaces, multiple memberships, local review, scopes, and audit behavior.

### TD-004 — Introduce runtime request contracts

- **Status:** done
- **Priority:** P0
- **Effort:** Medium
- **Why:** Route handlers parse untrusted JSON without a consistent runtime validation layer.
- **Scope:** Add Zod and `@life-os/contracts`; establish shared validation/error helpers; migrate the ten highest-risk mutation routes first.
- **Acceptance criteria:** Bulk, merge, admin-access, import, webhook, and assistant-tool inputs have tested runtime schemas and stable error responses.

### TD-005 — Add critical Playwright journeys

- **Status:** done
- **Priority:** P0
- **Effort:** Medium
- **Why:** The platform has 136 route handlers and 49 pages but no browser-level regression suite.
- **Scope:** Add local-review E2E coverage for People CRUD, staged import acceptance, workspace isolation, merge preservation, and one integration fixture flow.
- **Acceptance criteria:** Critical tests run deterministically in CI without production credentials or production-data writes.

### TD-006 — Formalize database and migration safety

- **Status:** done
- **Priority:** P0
- **Effort:** Medium
- **Why:** Prisma migrations, manual Turso scripts, and a shared core graph require one auditable deployment and recovery path.
- **Scope:** Document canonical migration workflow, add backup/restore and failed-migration runbooks, and test migration upgrades against sanitized fixtures.
- **Acceptance criteria:** A developer can prove forward migration and recovery without touching production data.

### TD-007 — Split Persons Admin into feature slices

- **Status:** done
- **Priority:** P1
- **Effort:** Medium
- **Why:** `AdminClient.tsx` combines multiple operational domains in one 1,800-line client component.
- **Scope:** Extract access, rules, calendar, Gmail, audit, shared controls, and typed API-client modules.
- **Acceptance criteria:** Each tab has an isolated component and testable data boundary; behavior and visual output remain stable.

### TD-008 — Extract and test People import matching

- **Status:** done
- **Priority:** P1
- **Effort:** Medium
- **Why:** Contact matching, quality scoring, review state, and presentation are coupled in a 1,296-line page.
- **Scope:** Move normalization, Jaro-Winkler matching, fillable-field logic, and review transitions into pure modules.
- **Acceptance criteria:** Matching behavior is characterized by unit tests and the page is primarily composition.

### TD-009 — Decompose Google integration modules

- **Status:** done
- **Priority:** P1
- **Effort:** High
- **Why:** Gmail and Calendar modules each combine OAuth, transport, parsing, orchestration, persistence, and tracing.
- **Scope:** Separate provider clients, token handling, parsers, sync orchestrators, persistence, and trace presenters; share safe Google infrastructure where behavior is genuinely common.
- **Acceptance criteria:** Provider HTTP is fixture-testable and sync orchestration is testable without live Google accounts.

### TD-010 — Extract Places map computation

- **Status:** done
- **Priority:** P1
- **Effort:** Medium
- **Why:** Projection, clustering, camera behavior, formatting, and rendering are coupled in a 1,143-line client component.
- **Scope:** Extract pure geo/map functions and split map layers and detail panels.
- **Acceptance criteria:** Projection and clustering have unit coverage; client component size and responsibility count are materially reduced.

### TD-011 — Establish dependency boundaries

- **Status:** done
- **Priority:** P1
- **Effort:** Low–Medium
- **Why:** Package boundaries are conventional rather than enforced, and scripts already import app internals.
- **Scope:** Add dependency-cruiser or ESLint boundary rules, remove script-to-app imports, and document permitted dependency direction.
- **Acceptance criteria:** CI rejects app-internal cross-imports, UI-to-Prisma imports, and package-to-app dependencies.

### TD-012 — Centralize stored JSON codecs and stable enums

- **Status:** done
- **Priority:** P1
- **Effort:** Medium–High
- **Why:** JSON encoded in strings and free-form statuses allow invalid state and repeated parsing logic.
- **Scope:** Add typed codecs for person contacts, rule definitions, and integration metadata; convert only stable vocabularies to Prisma enums.
- **Acceptance criteria:** Application/UI code does not parse these fields ad hoc, and invalid stored structures fail predictably.

### TD-013 — Add workflow observability

- **Status:** done
- **Priority:** P1
- **Effort:** Medium
- **Why:** Scheduled and external-provider workflows need operational telemetry beyond console output and domain audit records.
- **Scope:** Add structured logs, run/request IDs, durations, counters, terminal status, error tracking, and stale-sync indicators.
- **Acceptance criteria:** A failed or partial ingestion run can be diagnosed without reproducing it locally.

### TD-014 — Add performance and query budgets

- **Status:** done
- **Priority:** P2
- **Effort:** Medium
- **Why:** Growing lists, client components, and unbounded queries will create gradual performance regressions.
- **Scope:** Review `findMany` boundedness, add pagination/virtualization, narrow client DTOs, analyze bundles, and set route/query budgets.
- **Acceptance criteria:** Critical routes and client bundles have recorded baselines and regression thresholds.

### TD-015 — Add ownership, ADRs, and operational runbooks

- **Status:** done
- **Priority:** P2
- **Effort:** Low–Medium
- **Why:** A 3–8 person team needs lightweight ownership and durable decision context before growth accelerates.
- **Scope:** Add CODEOWNERS, concise module READMEs, ADR template/index, onboarding, secret rotation, restore, stuck-sync, and replay runbooks.
- **Acceptance criteria:** Every critical package has an owner, public contract, invariants, and recovery guidance.

### TD-016 — Define extraction criteria for future services

- **Status:** done
- **Priority:** P3
- **Effort:** Low
- **Why:** Explicit criteria prevent premature microservices while keeping future worker extraction deliberate.
- **Scope:** Record service extraction triggers covering scaling, reliability, runtime, ownership, transactions, and deployment cadence.
- **Acceptance criteria:** No service extraction proceeds without a short ADR demonstrating that at least two triggers are met.

## Progress log

| Date | Task | Result |
|---|---|---|
| 2026-07-15 | TD-001 | Added pinned ESLint 9 flat-config tooling, enforced correctness-focused TypeScript/React/Next.js rules, fixed a conditional Hooks violation, added lint to CI, and verified lint, type-check, and all 27 tests. |
| 2026-07-15 | TD-002 | Added Prisma schema validation, generated-client drift detection, all-33-migrations-from-zero validation on an isolated runner database, and production builds for all seven Next.js apps. Verified locally, including a network-enabled build for `next/font`. |
| 2026-07-15 | TD-003 | Added `@life-os/access` as the canonical runtime policy for Persons, Places, and Events; unified default Place/People scopes, workspace-aware cache keys, disabled-user behavior, explicit multi-workspace selection, and local review; added five database-backed contract tests. |
| 2026-07-15 | TD-004 | Added `@life-os/contracts` with Zod schemas and stable issue formatting; validated eleven high-risk merge, bulk People, access-admin, import-confirmation, and assistant-chat mutations; added four contract tests and preserved Persons' structured bad-request envelope. |
| 2026-07-15 | TD-005 | Added an isolated Playwright/Chromium gate for browser People creation plus API read/update/delete, workspace isolation, merge relationship preservation, staged Inbox acceptance, and contract failures. CI installs Chromium and runs all five journeys against a migration-built `/private/tmp` database with local-review auth; production credentials and data are never used. |
| 2026-07-15 | TD-006 | Added a CI migration/backup/restore drill across all 33 migrations with synthetic pre-conversion rows, value and foreign-key assertions, and a separately restored database. Added the canonical migration, production preflight, failed-migration, recovery, RPO/RTO, and restore-drill runbook; historical one-off Turso scripts are explicitly non-canonical. |
| 2026-07-16 | TD-007 | Centralized active Admin requests in a typed, directly tested API client; extracted API Keys, Roles, Rules, Permissions, Calendar, Audit, Workspace, and Gmail into typed feature components; removed obsolete Calendar sync behavior after its move to Events. Admin controller size fell from roughly 1,800 to 1,176 lines. Lint, type-check, nine Persons tests, and five critical Playwright journeys pass. |
| 2026-07-16 | TD-008 | Extracted normalization, Jaro-Winkler scoring, exact email/phone matching, fillable-field calculation, name inference, review status/sorting, and quality statistics into a pure module; extracted immutable bulk review transitions and the 250-line review card. Added eight characterization tests and fixed `+1` versus national-format phone matching. The page fell from 1,296 to 834 lines and now primarily orchestrates parsing, review, and confirmed writes. |
| 2026-07-16 | TD-009 | Done: consolidated bearer transport and OAuth token exchange; extracted fixture-tested Gmail and Calendar parsers; moved Calendar pagination, incremental sync-token behavior, and expired-token fallback into an injected provider client. Google behavior is now testable without live accounts, while domain modules retain persistence and audit orchestration. |
| 2026-07-16 | TD-010 | Done: extracted camera fitting, projection, pan/zoom, viewport tiling, clustering, fallback plotting, and marker sizing into a pure map-computation module; moved selected-place and unresolved-visit details into a dedicated component. The map client fell from 1,143 to 764 lines, with 4 focused computation tests and all 10 Places tests passing. |
| 2026-07-16 | TD-011 | Done: removed the repository script's import of a Persons internal utility; added a dependency-boundary gate to `npm run lint` and CI; enforced no package/script-to-app imports, no cross-app internal imports, and no client-UI-to-Prisma imports; documented the permitted dependency direction. The live tree passes and synthetic prohibited imports are rejected. |
| 2026-07-16 | TD-012 | Done: added shared, Zod-backed stored JSON codecs for Person string lists, rule conditions/actions, generic metadata records, Gmail metadata, and Calendar metadata. Active contact, rule, and integration parsing now uses those boundaries; malformed JSON and schema mismatches raise stable field-specific errors. Existing Prisma enums remain the stable database vocabularies, avoiding an unnecessary data migration. Five contract tests and 25 Persons tests pass. |
| 2026-07-16 | TD-013 | Done: added structured Gmail and Calendar workflow telemetry with run IDs, start/finish records, durations, counters, partial/success/failure terminal states, and error messages. Sync APIs return the run ID; status payloads expose stale age and failing state. Two observability tests and all 27 Persons tests pass. |
| 2026-07-16 | TD-014 | Done: recorded critical client authored-size and production route-JavaScript baselines; added CI regression ceilings for Persons Admin, People import, and Places map; ratcheted unbounded Prisma `findMany` calls at the measured 109; documented route latency, response-size, file-size, and pagination targets. Source and existing production-build budgets pass. |
| 2026-07-16 | TD-015 | Done: added default and critical-surface CODEOWNERS; app and package contract/invariant indexes; ADR template, index, and modular-monolith decision; an engineering onboarding path; and indexed secret-rotation, database recovery, stuck-sync, and replay runbooks. |
| 2026-07-16 | TD-016 | Done: documented backend, worker, and micro-frontend extraction triggers across scaling, reliability, runtime, ownership, deployment, and security. Service ADRs now require at least two measured triggers plus primitive ownership, transaction, authorization, observability, migration, and rollback plans. |
