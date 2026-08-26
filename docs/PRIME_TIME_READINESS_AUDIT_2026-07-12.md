# LifeOS Prime-Time Readiness Audit

**Date:** July 12, 2026  
**Scope:** Product ontology, relationship context, multi-tenancy, authorization, privacy, AI safety, integrations, reliability, deployment, and commercial operations  
**Verdict:** **Not ready for public sale or a multi-tenant beta.** The product is suitable for continued founder use and, after the immediate security fixes, a tightly controlled single-user design-partner pilot.

## Executive conclusion

LifeOS has a stronger conceptual foundation than most products at this stage. The manifesto's eight primitives, the separation of Events from Interactions, and the preference for derived insight over premature stored conclusions are sound. The existing schema also shows serious thought about provenance, staged ingestion, rules, integrations, and auditability.

The blocking problem is not the central idea. It is that the implementation still assumes one trusted owner and one default workspace in several decisive places while presenting the beginnings of a multi-user, multi-workspace system elsewhere. That mismatch creates real cross-tenant access and mutation paths. A customer must not be added until every read and write is workspace-scoped and permission-checked, integration credentials are encrypted, the database can be rebuilt from migrations, and the known framework security advisories are patched.

The recommended market motion is therefore:

1. Keep the eight primitives; do not redesign the ontology wholesale.
2. Complete a focused trust-boundary and migration-hardening release.
3. Run a paid, invite-only design-partner pilot with one life owner per workspace and optional integrations behind feature flags.
4. Add shared or household workspaces only after the product has an explicit observer/perspective model.

## Readiness scorecard

| Area | Status | Assessment |
|---|---|---|
| Product thesis and ontology | Promising | Coherent primitives and a differentiated view of personal context |
| Relationship-context model | Needs hardening | Good interaction history, but declared relationship meaning and observer perspective are incomplete |
| Tenant isolation and authorization | Blocked | Multiple routes and services can operate outside the authenticated workspace |
| Credential and data protection | Blocked | OAuth tokens are stored in plaintext; raw private content is retained without a complete policy/control layer |
| Database lifecycle | Blocked | The migration history cannot recreate a clean database |
| Dependency security | Blocked | Production audit reports 4 high and 5 moderate vulnerabilities, including a Next.js authorization-bypass class issue |
| Test and release confidence | Weak | Builds pass, but type-checking fails and all Places tests fail against a clean database |
| Privacy and regulatory readiness | Blocked | No complete consent, retention, export/deletion, incident, or integration-review program |
| Reliability and observability | Weak | No consistent error tracking, request correlation, SLOs, restore drills, or production release gate |
| Commercial operations | Not built | No billing, entitlements, customer onboarding, terms, support controls, or service commitments |

## What is already on solid ground

- **The primitive set is credible.** Person, Place, Item, Event, Plan, Group, State, and Note, connected through Interaction, cover the durable nouns of a personal context graph without turning every new feature into a new primitive.
- **Event versus Interaction is a useful distinction.** Separating what happened in the world from a person's involvement or interpretation enables better provenance and multiple perspectives.
- **The raw/derived and stated/inferred distinctions are correct goals.** These are essential for a trustworthy product that makes sensitive claims about people and relationships.
- **Ingestion is generally conservative.** Staging, review, integration links, source references, and rules indicate the right bias: preserve evidence before asserting identity or meaning.
- **Most canonical tables already carry a workspace ID.** This makes tenant hardening an achievable refactor rather than a ground-up rewrite.
- **Scoped, hashed API keys and audit-log infrastructure exist.** The newer mechanisms are directionally sound, although they are not used consistently across all apps and writes.
- **The monorepo builds.** All eight build tasks completed successfully during this audit.

## P0 blockers: resolve before any external customer

### 1. Enforce one trust boundary everywhere

**Finding.** Authentication is present, but authorization and tenant isolation are inconsistent. Several legacy Persons routes rely only on the proxy, do not call `requireAccess()`, and pass globally unique record IDs into domain code that does not filter by workspace. The contact merge flow can query, reassign, and delete records without a workspace condition. Import and administrative migration endpoints have similar gaps.

The Theory app hardcodes `default-workspace`. The Assistant authenticates an email but then uses an environment/default workspace and tools configured for the founder's graph. Stuff derives a workspace but does not enforce role permissions or validate that referenced People and Places belong to that workspace. These are not theoretical defense-in-depth concerns: together they permit authenticated users to read or mutate another customer's data.

**Evidence.** Review the access and merge paths in:

- `apps/persons/server/domain/access.ts`
- `apps/persons/server/domain/merge.ts`
- `apps/persons/app/api/contacts/merge/route.ts`
- `apps/persons/app/api/import/`
- `apps/persons/app/api/admin/`
- `apps/theory-of/app/api/notes/route.ts`
- `apps/assistant/app/api/chat/route.ts`
- `apps/assistant/lib/agent.ts`

**Required change.** Establish a single server-side request context containing `userId`, `workspaceId`, membership role, and granted permissions. Require it in every route and every domain command. Repositories must accept this context and include `workspaceId` in every query, mutation, relationship lookup, and uniqueness check. Remove all implicit `default-workspace` behavior from production paths. Add negative integration tests proving that IDs from workspace B cannot be read, linked, merged, updated, or deleted by a user in workspace A.

### 2. Replace global roles with membership-scoped authorization

**Finding.** `WorkspaceMember.role` exists, but effective authorization is based largely on a global `UserRole`. A global owner can therefore become owner across workspaces. `requireAccess()` chooses the first active membership instead of an explicitly selected workspace, caches access by email, and upserts the user's status to active during access resolution. A disabled user can be reactivated simply by signing in. The access overview also exposes global users, approved emails, and workspaces rather than a tenant-scoped administrative view.

On a fresh deployment, the first successful signer is allowed when the user table is empty. That is acceptable for a locally installed product with a deliberate bootstrap token, but it is a race-to-owner condition for a public SaaS deployment.

**Required change.** Make authorization membership-based. Select workspace explicitly by trusted session claim or validated route context. Cache by user and workspace, invalidate on membership/status changes, and never mutate account status during a permission check. Replace public first-user bootstrap with a one-time, expiring setup token or an operator-created owner. Add tests for disabled users, removed memberships, role downgrades, cache invalidation, and simultaneous bootstrap attempts.

### 3. Patch the exposed dependency chain

**Finding.** `npm audit --omit=dev` reports **9 production vulnerabilities: 4 high and 5 moderate**. The direct Next.js version, `16.2.3`, is affected by high-severity middleware/proxy-bypass and denial-of-service advisories; the reported patched target is `16.2.10`. This is especially serious because several application routes currently treat the proxy as their only access check. The direct Anthropic SDK and transitive `fast-uri`, `hono`, and `ws` dependencies also have reported advisories.

**Required change.** Upgrade Next.js and its aligned React/tooling dependencies immediately, rerun the complete build and browser flows, then remediate or explicitly risk-accept the remaining advisories with owner, rationale, and expiry. Add a production-dependency audit to CI.

### 4. Encrypt integration credentials and remove the legacy master key

**Finding.** Google Calendar, Gmail, and Era access/refresh tokens are represented as plaintext database fields; no application encryption/decryption boundary was found. A database leak would therefore become an immediate compromise of customers' connected accounts. The Persons app also retains a legacy `API_KEY` path that grants wildcard access to `default-workspace`; a production environment variable with that name is configured.

**Required change.** Encrypt credentials at the application boundary with envelope encryption backed by a managed key, record key version, rotate safely, redact from logs, and revoke on disconnect or account deletion. Prefer narrowly scoped, short-lived provider tokens. Migrate all callers to hashed, scoped API-key records and delete the wildcard legacy path and secret after validating usage.

### 5. Repair the database migration and recovery story

**Finding.** A clean migration replay fails. `20260710120000_add_places_import_tables` attempts to create `ImportJob`, which was already created by `20260513010000_add_google_maps_import`; a later synchronization migration also recreates an existing `PlaceNote`. These appear to be production drift repairs committed as universal migrations. Consequently, a new environment, disaster recovery, CI database, or new customer installation cannot be reliably created from source history.

All six Places tests fail with `SQLITE_ERROR`, consistent with this broken clean-database path.

**Required change.** Make the migration chain replayable without rewriting migrations that have already shipped unless the team has a formal baseline replacement procedure. Use guarded corrective migrations or create and document a new audited baseline. CI must create a database from zero, apply every migration, validate expected schema, run tests, and exercise a representative backup restore. Define recovery point and recovery time objectives and perform a restore drill before launch.

## P1 model and trust hardening

### 6. Decide whose life and whose perspective a workspace represents

The current schema mixes two ideas: a workspace as one person's life graph and a workspace as a multi-member collaboration space. Relationship context is observer-dependent. “I feel distant from Alex,” “Sam considers Alex close,” and “Alex is a member of our household” are different claims; a shared workspace must not merge them into one apparent truth.

For the first commercial version, define a workspace as **one life owner's graph**, with optional delegates who have explicit capabilities. Later, if shared households or teams are desired, add an observer/perspective dimension to subjective Interactions, States, declarations, and derived insights. Never infer that a workspace membership grants equal ownership of every person's sensitive context.

### 7. Make tenant integrity structural, not conventional

Most tables carry `workspaceId`, but foreign keys do not generally prove that connected records share it. Join tables such as `PersonGroup`, `GroupGroup`, `PlaceGroup`, `Assembly`, `ItemInteraction`, and `PlanExpectedPerson` can form cross-workspace edges if application checks fail. Polymorphic references in `State(entityType, entityId)` and `TheorySnapshotSource(sourceType, sourceId)` have neither foreign keys nor a structural tenant constraint.

Add workspace-aware composite unique keys and composite foreign keys where Prisma/SQLite permit them; otherwise centralize validated link commands and run integrity checks. Put `workspaceId` on joins whose integrity cannot otherwise be expressed. Replace or tightly constrain polymorphic references. Add a database audit that reports every cross-workspace edge and orphan.

Several globally unique fields also prevent tenant independence: `Place.googlePlaceId`, `Item.assetId`, and `Plan.externalInstanceId` should generally be unique within a workspace or provider account rather than across the service. Integration identifiers such as `"me"` and `"primary"` should support multiple connected accounts per workspace.

### 8. Complete the universal-link and relationship layers

The manifesto describes Interaction as the universal linker, but the current row directly links only Person, Event, and Place, with Items connected through a junction. It cannot link Group, Plan, State, or Note as full participants and can be created without a participant. Either narrow the documented contract or introduce a typed participant/edge table that can connect any primitive while enforcing workspace and role semantics.

For human relationships, the observed layer is reasonably rich, but the declared layer is too thin. `Person.closeness`, Plans, and free-form declaration Notes do not capture changing relationship roles, desired cadence, stated importance, boundaries, commitments, or the difference between the user's declaration and an inference. Add versioned, sourced declarations or typed relationship attributes without creating a ninth primitive. Derived prompts such as “you have not called someone important recently” should point to the declaration and events that produced them and be dismissible/correctable.

### 9. Add an observation support record without changing the primitives

Health and other high-frequency measurements place pressure on Note and State. A raw heart-rate sample is neither a durable Note nor necessarily an interpreted State. Introduce a non-primitive `Observation` support record for timestamped measurements with subject, metric, value/unit, source, observed time, ingestion time, confidence, and provenance. States can then be derived from observations and versioned definitions. This preserves the eight-primitive ontology while keeping raw evidence distinct from interpretation.

### 10. Make provenance and correction semantics real

The product says provenance is sacred and Notes are immutable, but Notes can be patched and deleted, source foreign keys can be set to null, and several surfaced entities lack a source reference. Define one consistent model:

- source records are immutable revisions;
- corrections append a revision and supersede the old assertion;
- deletion produces a tombstone or performs a documented legal-erasure workflow;
- every derived entity and insight records its source IDs, derivation version, time, and confidence;
- a user can inspect and correct why the system believes something.

Deleting a Person currently cascades some Plans and Interactions, destroying behavioral history. Separate ordinary archive/merge from privacy erasure. A merge should retain an auditable alias and provenance trail; erasure should deliberately enumerate and remove or anonymize dependent information.

### 11. Remove ambiguous data representations

- Store money as integer minor units or exact decimal plus ISO currency, not `Float`.
- Choose one canonical Event time representation; `start` and mirrored `timestamp` can drift.
- Replace business-critical free-form status/type strings with enums or validated value objects.
- Normalize data that must be queried or constrained instead of storing JSON-encoded strings.
- Enforce the intended cardinality where a Plan comment says “exactly one” fulfillment but the schema allows many Events.
- Define time zone, precision, and “all day” semantics for every temporal source.

### 12. Align raw-data storage with the sovereignty promise

The manifesto says raw files stay on disk and the graph stores derived signal, while the current file storage and Maps import paths retain raw or base64 file content in the primary database. This increases breach impact and complicates erasure and retention.

Create an encrypted raw-object abstraction with tenant keys, content hashes, retention classes, access audit, and explicit local/hosted backends. Store only the minimum necessary extracted signal in graph tables. Offer a complete workspace export, not just the current People-focused export/backup, and prove that it can be restored.

## AI, privacy, and integration readiness

### 13. Put consent and minimization ahead of model calls

The conversation import path can send a large block of private conversation text and existing contact information to Anthropic. Assistant tools can write Notes and Interactions based mainly on prompt instructions rather than a server-enforced approval policy. No consistent rate limit was found on costly or sensitive routes.

Before external use:

- explain exactly what data is sent, to which processor, for what purpose, and for how long;
- require affirmative consent for sensitive imports and optional AI features;
- minimize or locally redact payloads before transmission;
- make consequential tool writes previewable and server-approved;
- log model, prompt-policy version, tool calls, actor, source, and user confirmation without logging private payloads;
- defend tool calls against prompt injection and scope every tool to the request context;
- add per-user/workspace rate limits, budgets, abuse controls, and kill switches;
- negotiate zero-data-retention terms where the product claim or customer requires them.

Anthropic states that commercial API data is not used for model training by default and standard API inputs/outputs are normally deleted within 30 days; those provider terms still need to be accurately disclosed and matched to the product's promises.

### 14. Build the privacy operating system, not only a privacy page

This product combines relationship history, communications, health information, precise location history, financial context, and system-generated inferences. That is an unusually sensitive dataset. Before sale, implement:

- a data inventory and purpose/retention table;
- consent receipts and integration-specific disclosures;
- access, correction, export, deletion, restriction, and objection workflows;
- deletion propagation to processors and backups under a documented schedule;
- a subprocessor register, data-processing agreement, privacy policy, and terms;
- a security incident plan, breach assessment procedure, customer notification process, and evidence-preservation runbook;
- least-privilege staff access, audited break-glass support, and no invisible impersonation;
- age/eligibility policy and an explicit position on data about third parties who are not users.

This is issue-spotting, not legal advice. Counsel should determine the exact applicability. The likely launch obligations include:

- Google OAuth production verification, a public homepage/privacy policy, secure redirect configuration, and separate development/production projects.
- Gmail `readonly` is a restricted scope; storing or transmitting restricted-scope data through servers can require a recurring security assessment.
- Google's Limited Use requirements, including precise disclosures and restrictions on generalized AI training or unrelated transfers.
- The FTC Health Breach Notification Rule for a consumer health app combining health data from multiple sources.
- California rights around sensitive personal information, including health, precise geolocation, communications contents, and inferences.
- GDPR special-category handling and rights such as access, correction, erasure, portability, restriction, and objection where applicable.

## Reliability, release, and commercial operations

### 15. Turn CI into a release gate

Current evidence:

- `npm run build`: passed across eight build tasks.
- `npm run type-check`: failed because `scripts/era/copy-visits-to-prod.ts` lacks declarations for `better-sqlite3`.
- root script tests: 13 passed.
- Places tests: 6 failed with SQLite errors.
- clean migration replay: failed on duplicate table creation.

CI currently runs type-checking and tests on Node 22, but does not require a production build, clean migration replay, lint/format checks, dependency/security scanning, browser tests, or a deployment smoke test. Docker targets Node 24 while the audit environment used Node 25, adding avoidable variance.

Standardize a supported Node version and lock it in developer, CI, and container environments. A release must not deploy when type-checking, migrations, unit/integration tests, dependency policy, or core browser journeys fail. Use preview deployment validation and deliberate promotion/rollback rather than treating every successful build as releasable.

### 16. Add observable, recoverable operations

No consistent central error reporting, request correlation, distributed tracing, SLOs, synthetic checks, or restore drills were found. Console logging is not an operational system, especially when logs themselves can expose private context.

Before a paid pilot, add structured redacted logs, request IDs, error tracking, database/integration latency and failure metrics, queue/backlog visibility, AI cost and failure metrics, and synthetic checks for sign-in plus one read-only graph journey. Define ownership and alerts. Document rollback, provider outage behavior, degraded modes, support escalation, and database restore.

### 17. Finish the actual product envelope

The repository contains strong applications, but not yet a sellable service envelope. Missing capabilities include customer-safe onboarding, invitation and account recovery, workspace creation/selection, plan entitlements, billing/trials, feature flags, account deletion/export, public legal pages, support controls, service status, and a coherent packaging story. Deployment configuration is also uneven: not every app has a clearly linked project, and the Theory app is not represented consistently in local/deployed topology.

Do not build all enterprise machinery first. For a design-partner pilot, manual invoicing and operator-assisted onboarding are acceptable if security, consent, deletion/export, support access, and tenant isolation are real. Billing polish can follow trustworthiness; it cannot substitute for it.

## Recommended delivery sequence

### Phase 0: Containment (48 hours)

- Upgrade Next.js to the patched line and rerun all builds.
- Disable or operator-gate unsafe legacy import, merge, migration, Theory, and Assistant write paths until they are context-scoped.
- Verify the production local-review bypass is inert everywhere; Events and Stuff currently lack the required production double gate.
- Rotate/remove the legacy wildcard API key after identifying callers.
- Freeze external onboarding.

### Phase 1: Trust boundary (1–2 weeks)

- Implement explicit workspace selection and membership-scoped RBAC.
- Require access context in every route, domain command, repository query, AI tool, and integration job.
- Add cross-tenant negative tests and security regression tests.
- Encrypt OAuth credentials and implement revocation/rotation.
- Repair clean migrations and establish restore testing.

### Phase 2: Model integrity (2–4 weeks)

- Establish one-life-owner workspace semantics for v1.
- Add structural same-workspace constraints and integrity scans.
- Formalize Interaction participants or narrow its contract.
- Add versioned relationship declarations and observation support records.
- Implement immutable provenance/correction semantics and archive-versus-erasure behavior.
- Correct money, time, uniqueness, and validated-domain representations.

### Phase 3: Privacy and operations (3–6 weeks, partly parallel)

- Complete the data inventory, consent, retention, export, deletion, subprocessor, and incident programs.
- Complete Google verification/security-assessment work as required.
- Add release gates, error tracking, metrics, alerts, backup/restore drills, and an on-call/support runbook.
- Add AI approval controls, prompt-injection defenses, budgets, and rate limits.

### Phase 4: Paid design-partner pilot

- Invite 5–10 users individually.
- One life owner per workspace; delegates only through explicit permissions.
- Keep Gmail, health, and location imports optional and feature-flagged.
- Use manual billing if necessary.
- Review security, privacy requests, model corrections, incident metrics, support burden, and restore evidence before expanding.

## Launch gates

Do not call the product market-ready until every item below has objective evidence:

- [ ] No route, job, tool, or repository query can default to another tenant's workspace.
- [ ] Cross-tenant read/write/delete/link tests pass for every primitive and integration.
- [ ] Disabled users stay disabled; membership changes take effect immediately; bootstrap is controlled.
- [ ] Production dependencies have no unaccepted high/critical advisories.
- [ ] Provider credentials are encrypted, rotatable, revocable, and never logged.
- [ ] A clean database can be created entirely from the supported migration/baseline path.
- [ ] A production-like backup has been restored and checked within the stated RPO/RTO.
- [ ] Build, type-check, tests, migrations, dependency policy, and core browser journeys gate release.
- [ ] Full workspace export, account deletion, retention, and processor deletion are tested.
- [ ] Consent and provenance are visible for AI, communications, location, and health imports.
- [ ] Google production review and any required restricted-scope assessment are complete.
- [ ] Health/privacy incident obligations have an owner and tested runbook.
- [ ] Errors, integration failures, AI spend, and core journeys are monitored with actionable alerts.
- [ ] Terms, privacy policy, subprocessors, support access, and customer onboarding are production-ready.
- [ ] The first commercial scope explicitly promises one life owner per workspace, or the observer model is implemented.

## Sources and standards consulted

- [Google OAuth production policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [Gmail API scope classifications](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google Workspace API user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [FTC Health Breach Notification Rule compliance guidance](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)
- [California Consumer Privacy Act overview](https://oag.ca.gov/privacy/ccpa)
- [European Commission: data protection rights](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en)
- [Anthropic commercial data training policy](https://privacy.anthropic.com/en/articles/7996868-is-my-data-used-for-model-training)
- [Anthropic commercial data retention](https://privacy.anthropic.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)

## Bottom line

LifeOS does not need a new grand theory before it can become a product. It needs the implementation to honor the theory it already has: every claim must have a perspective and source; every action must have an actor and workspace; every sensitive datum must have a purpose, protection, and deletion path; and every release must be reproducible and recoverable.

Once the P0 gates are cleared, the product is credible enough for a small paid design-partner pilot. Until then, external onboarding would expose customers to unacceptable tenant-isolation, credential, and recovery risk.
