# Service and micro-frontend extraction criteria

LifeOS remains a modular monolith by default. Extraction is a response to measured constraints, not source-line count or architectural fashion.

## Required decision gate

No backend service, worker service, or micro-frontend extraction proceeds without an accepted ADR showing at least two triggers below, plus the safety questions and rollback plan.

## Backend or worker triggers

1. **Independent scaling:** a workload repeatedly exhausts CPU, memory, duration, concurrency, or provider quotas while normal web traffic remains healthy, and profiling shows isolation would solve it.
2. **Reliability isolation:** failures or retries in one workflow materially degrade unrelated requests; an asynchronous boundary and separate failure budget are required.
3. **Runtime mismatch:** the workload needs a runtime, region, native dependency, long execution window, queue, or networking model that the Next.js deployment cannot provide cleanly.
4. **Ownership boundary:** a stable team owns the capability end-to-end and needs an independent deploy/release cadence. One developer wearing two hats is not two teams.
5. **Deployment cadence:** the module changes and deploys independently often enough that monorepo build/deploy coupling creates measured lead-time or incident risk.
6. **Security/compliance isolation:** least privilege, data residency, credential isolation, or audit requirements cannot be achieved adequately inside the current process boundary.

## Micro-frontend triggers

1. Two or more autonomous teams need independent frontend releases and on-call ownership.
2. A surface has a distinct runtime/framework requirement with a stable navigation and design-system contract.
3. Frontend build or deploy coupling exceeds recorded performance/lead-time budgets and cannot be fixed with code splitting or monorepo caching.

Do not extract a micro-frontend merely because a client component is large. Decompose features, server/client boundaries, and bundles first.

## ADR safety questions

- Which LifeOS primitives does the candidate own, read, or mutate?
- Can one transaction currently span the candidate and another module? If yes, what replaces atomicity—an outbox, idempotent command, saga, or retained monolith write boundary?
- What is the versioned API/event contract and compatibility window?
- How are workspace authorization, audit, idempotency, tracing, backups, deletion, and replay preserved?
- What data is copied, and which store is authoritative? Shared-table dual ownership is forbidden.
- What are the SLO, alert, cost, and on-call owner?
- How will traffic and data return to the monolith if extraction fails?

## Preferred evolution path

1. Isolate a pure/domain module and enforce dependency direction.
2. Put slow provider work behind a durable queue or workflow while retaining one database owner.
3. Establish idempotent commands, structured telemetry, and versioned contracts.
4. Extract compute before data when possible.
5. Move data ownership only after transactional boundaries are proven and migration/rollback drills pass.

Likely future candidates are provider ingestion, media/AI enrichment, and scheduled synthesis—not Person, Interaction, or the shared primitive graph. Candidates still require evidence at decision time.
