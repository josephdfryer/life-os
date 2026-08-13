# ADR 0004: A customer-owned local Life Vault as the commercial storage boundary

- Status: proposed
- Date: 2026-08-12
- Owners: @josephdfryer
- Supersedes: the "Backend model" decision in `docs/IOS_PLATFORM_PLAN.md` §7
- Elaborated by: `docs/LIFE_OS_ECOSYSTEM_STRATEGY.md` (product direction and privacy language)

## Context

Two documents currently give opposite answers to "where does a paying customer's graph live?"

`docs/IOS_PLATFORM_PLAN.md` §7 says **one backend, strict-subset API**: `apps/api` serves both
audiences, customer workspaces see a narrow `/v1` surface, and "the data bones are in good shape"
because every primitive is already workspace-scoped with cascade deletes. That is an accurate
description of the code as it exists.

`docs/LIFE_OS_ECOSYSTEM_STRATEGY.md` (2026-08-12) says the opposite: "Customer Life Vaults do not
use the existing cloud Prisma database as canonical storage." It proposes a device-first encrypted
local database, optional customer-owned iCloud sync, and a Life OS control plane that never
receives graph content.

The strategy document was linked from the platform plan with a banner calling the older sections
"historical implementation analysis." That is not a decision — it leaves two live documents
disagreeing, with no record of what was traded away. ADR 0001 is explicit that this project changes
architectural direction "through a superseding ADR, not a one-off import exception." This ADR is
that record.

Three facts constrain the choice.

**The manifesto already asked for this, for Joseph, and never got it.**
`docs/MANIFESTO.md:117` — "Local-first and Mac-native. This runs on my machine… The most intimate
model of my life should not live on someone else's server." `:119` — "Zero recurring service cost.
I will not rent the right to access my own life." `:122` names the reason: sovereignty. The system
as built runs on Turso and Vercel. The vault direction is not a new idea imported for commercial
reasons; it is the founding constraint, unmet.

**The domain layer is deeply database-coupled, and that is the real cost.**
36 non-test files under `packages/` import `@life-os/db` directly. `packages/domain`,
`packages/automation`, `packages/intelligence`, `packages/alignment`, and `packages/access` total
~7,100 non-test lines written against the Prisma client, including `db.$transaction` semantics that
ADR 0002 made load-bearing: every canonical command must write its records and its `GraphEvent`
atomically, and `GraphEventReceipt`'s unique `(event, consumer)` constraint "is the entire
idempotency guarantee." A local vault does not merely need a different driver. It needs those
guarantees reproduced in a second language against a second engine, and kept identical forever.

**The customer surface today is a web surface.** Persons, Home, Places, Level Up, Events, Stuff,
Assistant and Theory-of are all Next.js apps reading the cloud database directly. A local vault
makes the existing customer-facing web UI structurally impossible, not merely inconvenient. The
saleable product becomes Apple-native or it does not exist.

## Decision

Adopt the customer-owned local Life Vault as the **target** commercial storage boundary, staged
behind proof gates, with the following boundaries fixed now.

**1. Two storage lines, one semantic contract.** The personal Life OS keeps the cloud-backed
Turso graph as canonical during the entire build-out. Customer vaults are local-first. What must
not fork is meaning: the eight primitives, the `Interaction` edge, provenance and authority bands,
`GraphEvent` semantics, and command names/effects are one specification with one conformance suite,
regardless of which store executes them.

**2. The conformance suite is the deliverable, not the vault.** Before any Swift storage code is
written, extract the command/read contracts and a language-neutral fixture set: given this input
sequence, a conforming store produces exactly these canonical rows, these `GraphEvent`s, and these
derived reads. Both `PrismaGraphStore` (existing) and `LifeVaultStore` (new, GRDB) must pass the
same fixtures. If a behavior cannot be expressed as a fixture, it is not yet a contract and it does
not get a second implementation.

**3. Joseph's graph is the first vault tenant, not the last.** The strategy document's sequencing
put shadow-mode validation against Joseph's data at step 6, after the AI stack. That is backwards:
it means the sovereignty architecture ships to strangers before the person who wrote the
sovereignty requirement has ever run it. Reordered — the vault must carry Joseph's real graph in
shadow mode, with recovery tested, before any customer-facing work depends on it. This is also the
only honest way to size the effort.

**4. The control plane is content-free, and that is a schema-level rule.** Life OS servers may hold
account/entitlement identifier, subscription state, app and schema version, aggregate crash
diagnostics, and opt-in support material. Control-plane records must not contain life-graph
identifiers, names, or content. This is enforced by a test over the control-plane schema, not by
review discipline.

**5. Inference credentials: on-device first, bring-your-own-key second, managed inference not at
all in v1.** The strategy document raised customer-owned API credentials versus Life OS-proxied
inference and decided neither. Deciding it now, because it determines whether the privacy claim
survives:

- v1 ships **Private Intelligence** (deterministic local reasoning plus Apple's on-device
  Foundation Models) as the only path a customer can use without extra setup.
- **Connected Intelligence is bring-your-own-key**, stored in the device Keychain, with requests
  going device-to-provider. Life OS is never in the content path. This reuses the pattern already
  in the schema — `AiProviderCredential` (`packages/db/prisma/schema.prisma:1401`) already stores
  `apiKeyEncrypted` per provider — so it is the established convention here, not a new one.
- **Life OS-proxied managed inference is out of scope for v1 and requires its own ADR.** If Life OS
  ever proxies plaintext prompts for auth, billing, moderation, caching, or observability, Life OS
  processes that content and the zero-access claim is dead. That trade may eventually be worth
  making; it may not be made implicitly.

The accepted cost is that Connected Intelligence has a developer-grade onboarding step and is not a
mass-market feature at launch. That is the correct trade while there are zero customers, and it
keeps the hardest commercial decision reversible.

**6. Third-party data in the graph is a first-class design constraint.** A Persons graph is mostly
data *about people who are not the customer* — contacts, message bodies, meeting transcripts. Every
design in this ADR must be evaluated for them, not only for the account holder. Concretely: the
vault being local materially reduces Life OS's own exposure, but the Connected Intelligence path
transmits other people's personal data to a model provider on the customer's instruction, and the
grant UI must say so in those words. Per-subject exclusion (a person or group marked never-share)
must exist before Connected Intelligence ships. The legal posture — controller/processor roles, and
whether the personal-and-household exemption survives a product sold as a professional CRM — needs
counsel review before App Store submission, not after; this ADR fixes the engineering requirements
that any answer will need.

**7. Explicit non-goals.** No customer web client for vault-backed data. No server-side querying,
joins, or background jobs over customer graphs. No support-side inspection of customer data. No
Life OS training on customer data, ever, under any tier.

## Alternatives considered

- **Shared cloud database with workspace scoping (the current §7 position).** Cheapest by a wide
  margin: the schema is already workspace-scoped with cascade deletes, `packages/access` exists,
  and the web apps keep working. Rejected as the *target* because it makes the central promise
  unavailable — Life OS would hold every customer's graph in plaintext and the honest privacy
  language would have to say so. §7's own risk note (a tenancy bug has blast radius across both
  audiences) is real and grows with every customer. Retained as the interim state for Joseph's
  personal system, which is not a tenancy problem because there is one tenant.
- **Database-per-customer (Turso).** Removes cross-tenant blast radius and keeps server-side
  querying and the web surface. Rejected as the target: Life OS still holds and can read every
  customer's data, so it buys isolation but not sovereignty. Worth reconsidering only if the vault
  fails a gate below — it is the natural fallback, and this ADR deliberately does not burn it.
- **Local vault with no sync at all.** Strongest privacy, rejected on product grounds: device loss
  equals total loss, and a relationship graph that does not follow the customer to a new phone is
  not a product.
- **Ship the vault first, migrate Joseph later.** Rejected — see decision 3.
- **Do nothing until there are paying customers.** Genuinely tempting given there are none. Rejected
  narrowly, because the decisions that are expensive to reverse (where domain logic lives, whether
  commands are storage-neutral) are being made *right now* in the companion and API work, and a
  contract-extraction step is worth doing even if the vault never ships.

## Consequences

**Harder, and honestly so.** The domain layer gets a second implementation in Swift/GRDB and a
conformance suite that must never drift; ~7,100 lines of TypeScript is the floor for what has to be
re-expressed or made portable. Cloud-run Gmail, calendar, finance, synthesis and automation jobs
need device-run equivalents or must be described to customers as optional cloud-processing modes
with a different privacy story. Schema migrations must survive vaults that have been offline for
months. Local search, indexing, derived read models, storage monitoring, export, repair and
recovery UX all become product work that the cloud currently gives free. Cross-platform and browser
clients are given up for customers.

**Easier.** The privacy claim becomes defensible rather than aspirational. Tenancy bugs stop being
an existential class of failure for the customer line. Apple-native performance and offline
behavior come free rather than being fought for. The manifesto's founding constraint finally gets
satisfied for Joseph too.

**Irreversible-ish.** Contract extraction is safe and reversible. Everything downstream of a
customer holding the only copy of their key is not: once vaults exist in the wild, key-handling and
recovery mistakes cannot be fixed server-side.

**Unchanged.** §7's five real blockers for a saleable Persons survive this ADR intact and are not
addressed by it: `ApprovedEmail` is an allowlist and customers need self-serve signup; Sign in with
Apple is mandatory alongside Google SSO; StoreKit 2 subscriptions plus entitlement checks; privacy
nutrition labels and a deletion path; and a customer's input set is thinner than Joseph's, so
capture UX must carry weight that scraping currently carries.

## Verification and rollback

Gates, in order. Each must pass before the next begins.

1. **Contract gate.** Command/read contracts and language-neutral fixtures exist, and the *current*
   Prisma implementation passes them unmodified. If today's code cannot pass its own extracted
   contract, the contract is wrong.
2. **Parity gate.** `LifeVaultStore` passes the identical fixture set. First vertical slice:
   `captureNote` → `Note` + `GraphEvent`, identical canonical output from both stores.
3. **Shadow gate.** Joseph's real graph replays into a local vault; canonical rows and derived
   reads are compared against the Turso system, which stays canonical throughout. No existing
   system is disabled.
4. **Recovery gate.** New-device restore, lost-device recovery, Keychain reset, iCloud disabled and
   iCloud full, offline migration across several schema versions, conflict resolution, and account
   deletion — each tested and documented, with the CloudKit record and metadata inspection written
   down rather than assumed.
5. **AI gate.** Model routing verified independently and failing closed; grant enforcement proven,
   including that a revoked provider cannot query; per-subject exclusion honored; indirect prompt
   injection red-teamed from email, document, calendar and transaction text.
6. **Claims gate.** Cryptographic design and final customer-facing wording reviewed independently,
   and legal review of third-party data obligations, before submission.

**Rollback.** Gates 1–2 produce only additive code and cost nothing to abandon — the contract suite
is worth keeping either way as a regression net over `packages/domain`. Gate 3 failing means the
vault cannot represent the real graph; fall back to database-per-customer Turso, which this ADR
preserves as a live option. Gate 4 failing is the serious one: if recovery cannot be made safe,
local-only canonical storage must not ship, and the fallback is again per-customer cloud with
honest language about what Life OS can see.

**Abandonment criteria.** Abandon the vault direction, and say so in a superseding ADR, if any
holds: the conformance suite cannot keep two implementations in agreement without per-release
manual reconciliation; the shadow gate shows Joseph's graph needs cloud-only processing that has no
viable device equivalent; recovery testing shows a realistic path to unrecoverable customer data
loss; or the effort passes the point where the personal system — the thing that actually works and
is used daily — is being starved to fund a product with no customers.

## Extraction triggers (services only)

Not applicable. This is a storage and portability decision inside the existing modular monolith. It
does not extract a service, and ADR 0001's boundary enforcement continues to apply to all
TypeScript packages.
